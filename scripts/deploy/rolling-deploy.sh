#!/usr/bin/env bash
# DoruTJ — rolling-деплой api/worker (DTJ-428).
# SRS: SRS-NFR-055 (миграция ДО api/worker), SRS-NFR-056 (zero-downtime политика миграций,
# соблюдается на уровне самих миграций — см. apps/api/migrations, не в этом скрипте),
# SRS-NFR-062 (rolling-последовательность, дословно реализована ниже), SRS-NFR-037 (healthcheck).
# Владение: files_owned DTJ-428 (scripts/deploy/**).
#
# Последовательность (SRS-NFR-062):
#   (1) docker compose pull новых образов по тегу IMAGE_TAG;
#   (2) migrate-контейнер — ждём service_completed_successfully; провал ОСТАНАВЛИВАЕТ деплой
#       ДО того, как api/worker тронуты (SRS-NFR-055) — старые контейнеры продолжают работать;
#   (3) docker compose up -d --no-deps api worker — ТОЛЬКО эти два сервиса, БД/Redis/MinIO не
#       трогаются;
#   (4) healthcheck нового контейнера должен пройти ДО того, как деплой считается успешным
#       (`docker compose up --wait`) — при `replicas: 2` Compose пересоздаёт реплики
#       последовательно, а не все разом, поэтому используем ДОПОЛНИТЕЛЬНЫЙ параллельный
#       поллинг `HEALTH_URL` во время шага (3), чтобы явно подтвердить критерий приёмки 2
#       («минимум 1 инстанс api отвечает 200 в любой момент деплоя»), а не просто верить
#       поведению Compose по умолчанию;
#   (5) итоговый статус: SUCCESS или ROLLBACK REQUIRED (см. scripts/deploy/rollback.sh).
#
# Использование:
#   scripts/deploy/rolling-deploy.sh <IMAGE_TAG>
#
# ENV (все опциональны, есть дефолты для dev/staging-профиля):
#   COMPOSE_FILES              — список -f флагов compose (default: dev + prod override)
#   IMAGE_REPOSITORY_API       — имя образа api без тега (default dorutj-api)
#   IMAGE_REPOSITORY_WORKER    — имя образа worker без тега (default dorutj-worker)
#   HEALTH_URL                 — эндпоинт для параллельного поллинга (default http://localhost:3000/ready)
#   HEALTH_MAX_DOWNTIME_SEC    — допустимая непрерывная серия неудачных проверок, сек (default 5)
#   HEALTH_WAIT_TIMEOUT_SEC    — таймаут `docker compose up --wait`, сек (default 120)
#   SKIP_PULL=1                — пропустить шаг (1) (ТОЛЬКО для локальной/тестовой проверки без
#                                 registry — НЕ использовать для реального прод-релиза)
#
# ВАЖНО про IMAGE_TAG/`docker compose pull`: `pull` тянет образ ТОЛЬКО если у сервиса задано
# поле `image:` — `infra/docker/docker-compose.yml` теперь задаёт его аддитивно
# (`image: ${API_IMAGE:-dorutj-api:local}` / `${WORKER_IMAGE:-...}`), этот скрипт экспортирует
# `API_IMAGE`/`WORKER_IMAGE` из аргумента IMAGE_TAG ПЕРЕД вызовом `docker compose`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

IMAGE_TAG="${1:?Использование: $0 <IMAGE_TAG>}"

COMPOSE_FILES="${COMPOSE_FILES:--f infra/docker/docker-compose.yml -f infra/docker/docker-compose.prod.yml}"
IMAGE_REPOSITORY_API="${IMAGE_REPOSITORY_API:-dorutj-api}"
IMAGE_REPOSITORY_WORKER="${IMAGE_REPOSITORY_WORKER:-dorutj-worker}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/ready}"
HEALTH_MAX_DOWNTIME_SEC="${HEALTH_MAX_DOWNTIME_SEC:-5}"
HEALTH_WAIT_TIMEOUT_SEC="${HEALTH_WAIT_TIMEOUT_SEC:-120}"

export IMAGE_TAG
export API_IMAGE="${IMAGE_REPOSITORY_API}:${IMAGE_TAG}"
export WORKER_IMAGE="${IMAGE_REPOSITORY_WORKER}:${IMAGE_TAG}"

# shellcheck disable=SC2086 -- COMPOSE_FILES обязан расщепляться на несколько -f <file> аргументов
dc() { docker compose $COMPOSE_FILES "$@"; }

log "rolling-deploy: релиз ${IMAGE_TAG} (api=${API_IMAGE}, worker=${WORKER_IMAGE})"

# --- (1) pull ---------------------------------------------------------------------------------
if [[ "${SKIP_PULL:-0}" == "1" ]]; then
  warn "SKIP_PULL=1 — шаг pull пропущен (допустимо только для локальной проверки, НЕ для прод-релиза)"
else
  log "шаг 1/4: docker compose pull"
  if ! dc pull; then
    err "pull новых образов (тег ${IMAGE_TAG}) провалился — деплой ПРЕРВАН до миграции, старые контейнеры не тронуты"
    exit 1
  fi
fi

# --- фоновый поллинг HEALTH_URL на время рискованного окна (шаг 3) ----------------------------
HEALTH_LOG="$(mktemp)"
POLL_PID=""
poll_health() {
  while true; do
    if curl -fsS -o /dev/null -m 2 "$HEALTH_URL" 2>/dev/null; then
      echo "$(date +%s) up" >>"$HEALTH_LOG"
    else
      echo "$(date +%s) down" >>"$HEALTH_LOG"
    fi
    sleep 1
  done
}

# --- (2) migrate --------------------------------------------------------------------------------
log "шаг 2/4: migrate-контейнер (ждём service_completed_successfully)"
if ! dc up migrate --exit-code-from migrate; then
  err "МИГРАЦИЯ ПРОВАЛИЛАСЬ — деплой остановлен ДО пересоздания api/worker."
  err "Старые контейнеры api/worker продолжают работать (система не оставлена в промежуточном состоянии)."
  rm -f "$HEALTH_LOG"
  exit 1
fi
log "миграция применена успешно"

# --- (3)+(4) recreate api/worker, health-gate --------------------------------------------------
log "шаг 3/4: docker compose up -d --no-deps api worker (только stateless-сервисы, --wait до healthy)"
poll_health &
POLL_PID=$!
# shellcheck disable=SC2064 -- POLL_PID должен раскрыться СЕЙЧАС (значение на момент trap), не при выходе
trap "kill '$POLL_PID' 2>/dev/null || true" EXIT

DEPLOY_OK=1
if ! dc up -d --no-deps --wait --wait-timeout "$HEALTH_WAIT_TIMEOUT_SEC" api worker; then
  DEPLOY_OK=0
fi

kill "$POLL_PID" 2>/dev/null || true
wait "$POLL_PID" 2>/dev/null || true
trap - EXIT

if [[ "$DEPLOY_OK" != "1" ]]; then
  err "HEALTHCHECK НЕ ПРОШЁЛ на новых контейнерах api/worker в течение ${HEALTH_WAIT_TIMEOUT_SEC}s"
  err "ИТОГ: ROLLBACK REQUIRED — запустите scripts/deploy/rollback.sh <предыдущий_тег>"
  rm -f "$HEALTH_LOG"
  exit 1
fi

# --- (5) анализ непрерывности + итог ------------------------------------------------------------
log "шаг 4/4: анализ непрерывности ${HEALTH_URL} во время rolling-обновления"
MAX_GAP=$(awk '
  $2=="down"{ if(start==""){start=$1} last=$1; next }
  $2=="up"{ if(start!=""){ gap=last-start+1; if(gap>max) max=gap; start="" } }
  END{ if(start!=""){ gap=last-start+1; if(gap>max) max=gap }; print max+0 }
' "$HEALTH_LOG")
rm -f "$HEALTH_LOG"

if (( MAX_GAP > HEALTH_MAX_DOWNTIME_SEC )); then
  err "во время деплоя зафиксирован непрерывный простой ${HEALTH_URL} ${MAX_GAP}s (> HEALTH_MAX_DOWNTIME_SEC=${HEALTH_MAX_DOWNTIME_SEC}s)"
  err "ИТОГ: ROLLBACK REQUIRED — минимум 1 инстанс api НЕ отвечал 200 дольше допустимого порога"
  exit 1
fi

log "минимум 1 инстанс отвечал 200 на ${HEALTH_URL} на протяжении всего деплоя (макс. непрерывный простой ${MAX_GAP}s <= ${HEALTH_MAX_DOWNTIME_SEC}s)"
log "ИТОГ: SUCCESS — релиз ${IMAGE_TAG} развёрнут (api/worker пересозданы, healthcheck зелёный)"
