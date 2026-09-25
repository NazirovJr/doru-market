#!/usr/bin/env bash
# DoruTJ — восстановительные учения из бэкапа (DTJ-428).
# SRS: SRS-NFR-065 §«Данные» п.1 (pg_dump/WAL-архивирование ПРОВЕРЕНО реальным восстановлением),
# SRS-NFR-036 строка 9 (RTO ≤4ч).
# Владение: files_owned DTJ-428 (scripts/deploy/**).
#
# ПРЕДНАЗНАЧЕН ДЛЯ РУЧНОГО ЕЖЕКВАРТАЛЬНОГО ЗАПУСКА ОПЕРАТОРОМ, НЕ для автоматического CI —
# восстановление production-объёма данных дорого по времени (тикет DTJ-428, «Что сделать» п.3).
#
# Восстанавливает бэкап НА ОТДЕЛЬНЫЙ, ИЗОЛИРОВАННЫЙ одноразовый Postgres-контейнер
# (никогда НЕ production и НЕ dev/prod-стек infra/docker/docker-compose*.yml — отдельный
# `docker run`, отдельный порт, удаляется в конце через trap), выполняет проверочный запрос,
# печатает время выполнения для сверки с целевым RTO.
#
# Использование:
#   scripts/deploy/backup-restore-drill.sh <путь_к_бэкапу> [проверочный_SQL]
#
# <путь_к_бэкапу> — файл `pg_dump` в custom-формате (-Fc, определяется по сигнатуре "PGDMP")
# ЛИБО обычный `.sql` (plain-текст, включая вывод `pg_dumpall`/`pg_dump --format=plain`).
# [проверочный_SQL] — по умолчанию `SELECT count(*) FROM orders` (тикет, критерий приёмки 4);
# на минимальном синтетическом дампе (без таблицы orders) передайте свой запрос вторым
# аргументом, например `SELECT 1`.
#
# ENV (опциональны):
#   DRILL_CONTAINER — имя одноразового контейнера (default dorutj-backup-restore-drill)
#   DRILL_IMAGE     — образ Postgres для изолированного инстанса (default postgres:16 — та же
#                     мажорная версия, что и infra/docker/docker-compose.yml)
#   DRILL_DB/DRILL_USER/DRILL_PASSWORD — учётные данные ОДНОРАЗОВОГО тестового инстанса (НЕ прод)
#   DRILL_PORT      — порт на хосте (default 55432, НЕ 5432 — не конфликтует с dev-стеком)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

BACKUP_FILE="${1:?Использование: $0 <путь_к_бэкапу> [проверочный_SQL]}"
VERIFY_SQL="${2:-SELECT count(*) FROM orders}"

DRILL_CONTAINER="${DRILL_CONTAINER:-dorutj-backup-restore-drill}"
DRILL_IMAGE="${DRILL_IMAGE:-postgres:16}"
DRILL_DB="${DRILL_DB:-dorutj_restore_drill}"
DRILL_USER="${DRILL_USER:-dorutj_migrator}"
DRILL_PASSWORD="${DRILL_PASSWORD:-dorutj_drill_password}"
DRILL_PORT="${DRILL_PORT:-55432}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  err "файл бэкапа не найден: $BACKUP_FILE"
  exit 1
fi

cleanup() {
  log "удаляю изолированный тестовый инстанс ${DRILL_CONTAINER}"
  docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "поднимаю ИЗОЛИРОВАННЫЙ тестовый Postgres (${DRILL_CONTAINER}, порт ${DRILL_PORT}) — НЕ production, НЕ dev-стек"
docker run -d --name "$DRILL_CONTAINER" \
  -e POSTGRES_USER="$DRILL_USER" \
  -e POSTGRES_PASSWORD="$DRILL_PASSWORD" \
  -e POSTGRES_DB="$DRILL_DB" \
  -p "${DRILL_PORT}:5432" \
  "$DRILL_IMAGE" >/dev/null

log "жду готовности изолированного инстанса..."
# ВАЖНО: одного `pg_isready` недостаточно — официальный образ postgres делает ВТОРОЙ внутренний
# рестарт после initdb (кратковременное окно, где pg_isready уже отвечает "accepting connections",
# но сервер тут же уходит в "the database system is shutting down") — живым прогоном при
# реализации этого скрипта поймано реальное падение psql на этом окне. Ждём реального успешного
# `SELECT 1`, не только pg_isready.
READY=0
for _ in $(seq 1 60); do
  if docker exec "$DRILL_CONTAINER" pg_isready -U "$DRILL_USER" -d "$DRILL_DB" >/dev/null 2>&1 \
    && docker exec -e PGPASSWORD="$DRILL_PASSWORD" "$DRILL_CONTAINER" \
      psql -U "$DRILL_USER" -d "$DRILL_DB" -t -A -c 'SELECT 1' >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [[ "$READY" != "1" ]]; then
  err "изолированный Postgres не перешёл в ready за 60s"
  exit 1
fi

START_TS=$(date +%s)

BACKUP_MAGIC="$(head -c 5 "$BACKUP_FILE" 2>/dev/null || true)"
if [[ "$BACKUP_MAGIC" == "PGDMP" ]]; then
  log "формат бэкапа: pg_dump custom (-Fc), файл /tmp/backup.dump в контейнере"
  docker cp "$BACKUP_FILE" "$DRILL_CONTAINER:/tmp/backup.dump"
  if ! docker exec -e PGPASSWORD="$DRILL_PASSWORD" "$DRILL_CONTAINER" \
    pg_restore -U "$DRILL_USER" -d "$DRILL_DB" --no-owner --exit-on-error -v /tmp/backup.dump; then
    err "pg_restore завершился с ошибкой — восстановление НЕ подтверждено"
    exit 1
  fi
else
  log "формат бэкапа: plain SQL, файл /tmp/backup.sql в контейнере"
  docker cp "$BACKUP_FILE" "$DRILL_CONTAINER:/tmp/backup.sql"
  if ! docker exec -e PGPASSWORD="$DRILL_PASSWORD" "$DRILL_CONTAINER" \
    psql -U "$DRILL_USER" -d "$DRILL_DB" -v ON_ERROR_STOP=1 -f /tmp/backup.sql; then
    err "восстановление из plain SQL завершилось с ошибкой — восстановление НЕ подтверждено"
    exit 1
  fi
fi

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

log "проверочный запрос: ${VERIFY_SQL}"
RESULT="$(docker exec -e PGPASSWORD="$DRILL_PASSWORD" "$DRILL_CONTAINER" \
  psql -U "$DRILL_USER" -d "$DRILL_DB" -t -A -c "$VERIFY_SQL" | tr -d '[:space:]')"

if [[ -z "$RESULT" ]]; then
  err "проверочный запрос не вернул значение — восстановление НЕ подтверждено (данные не читаемы)"
  exit 1
fi

log "проверочный запрос вернул: ${RESULT}"
log "время восстановления: ${ELAPSED}s"
log "  (сверить с целевым RTO <=4ч, SRS-NFR-036 строка 9 — ЭТОТ прогон на тестовом дампе, не на"
log "  production-объёме; реальный замер RTO — отдельная организационная проверка перед первым"
log "  прод-релизом, см. docs/RUNBOOK-PRODUCTION-READINESS.md)"
log "ИТОГ: восстановление подтверждено — данные реально читаемы после restore, не пустая БД"
