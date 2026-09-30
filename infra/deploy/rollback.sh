#!/usr/bin/env bash
# DoruTJ — откат api/worker к предыдущему релизному тегу (DTJ-428).
# SRS: SRS-NFR-063 (последовательность отката + предупреждение о необратимой миграции схемы),
# SRS-DB-034 (drizzle-kit генерирует только forward-миграции; sibling *.down.sql — политика
# проекта для ALTER существующей таблицы, не для CREATE новой).
# Владение: files_owned DTJ-428 (scripts/deploy/**).
#
# Использование:
#   scripts/deploy/rollback.sh <PREVIOUS_IMAGE_TAG>
#
# Что делает:
#   1. Определяет ПОСЛЕДНЮЮ ПРИМЕНЁННУЮ миграцию по журналу drizzle-kit
#      (apps/api/migrations/meta/_journal.json, поле `tag` последней записи) и проверяет,
#      существует ли рядом sibling-файл `<tag>.down.sql` — простая файловая проверка (не парсинг
#      SQL, как явно требует тикет). Если файла НЕТ — печатает явное предупреждение о
#      невозможности автоматического отката СХЕМЫ БД ДО отката кода приложения (SRS-NFR-063).
#      Откат кода ПРОДОЛЖАЕТСЯ после предупреждения (решение — за оператором/DBA, скрипт не
#      блокирует безусловно: чистый CREATE TABLE без down безопасен для отката кода, SRS-NFR-063).
#   2. Пересоздаёт ТОЛЬКО api/worker со старым тегом образа:
#      `docker compose up -d --no-deps api worker` (SRS-NFR-063, дословно).
#
# Откат СХЕМЫ БД (применение *.down.sql) этот скрипт НЕ выполняет автоматически — это ручное
# вмешательство DBA (SRS-NFR-063: «требует ручного вмешательства DBA»), сознательно не
# автоматизируется здесь.
#
# ENV (опциональны):
#   COMPOSE_FILES           — список -f флагов compose (default: dev + prod override)
#   IMAGE_REPOSITORY_API    — имя образа api без тега (default dorutj-api)
#   IMAGE_REPOSITORY_WORKER — имя образа worker без тега (default dorutj-worker)
#   MIGRATIONS_DIR          — каталог миграций (default apps/api/migrations)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

PREVIOUS_IMAGE_TAG="${1:?Использование: $0 <PREVIOUS_IMAGE_TAG>}"

COMPOSE_FILES="${COMPOSE_FILES:--f infra/docker/docker-compose.yml -f infra/docker/docker-compose.prod.yml}"
IMAGE_REPOSITORY_API="${IMAGE_REPOSITORY_API:-dorutj-api}"
IMAGE_REPOSITORY_WORKER="${IMAGE_REPOSITORY_WORKER:-dorutj-worker}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-apps/api/migrations}"

# shellcheck disable=SC2086 -- COMPOSE_FILES обязан расщепляться на несколько -f <file> аргументов
dc() { docker compose $COMPOSE_FILES "$@"; }

# --- (1) проверка down-файла последней применённой миграции (SRS-NFR-063/SRS-DB-034) ----------
JOURNAL="$MIGRATIONS_DIR/meta/_journal.json"
if [[ ! -f "$JOURNAL" ]]; then
  warn "журнал миграций не найден ($JOURNAL) — пропустить проверку down-файла НЕВОЗМОЖНО безопасно."
  warn "Проверьте схему БД вручную ПЕРЕД продолжением отката."
else
  LAST_TAG="$(node -e "
    const j = require(require('path').resolve(process.argv[1]));
    const e = j.entries && j.entries[j.entries.length - 1];
    process.stdout.write(e ? e.tag : '');
  " "$JOURNAL")"

  if [[ -z "$LAST_TAG" ]]; then
    warn "журнал миграций пуст — пропускаю проверку down-файла"
  elif [[ -f "$MIGRATIONS_DIR/${LAST_TAG}.down.sql" ]]; then
    log "последняя применённая миграция '${LAST_TAG}' имеет ${LAST_TAG}.down.sql — откат схемы технически возможен (применяется ВРУЧНУЮ DBA, не этим скриптом)"
  else
    warn "=================================================================================="
    warn "ПРЕДУПРЕЖДЕНИЕ (SRS-NFR-063 / SRS-DB-034):"
    warn "  Последняя применённая миграция '${LAST_TAG}' НЕ имеет файла ${LAST_TAG}.down.sql."
    warn "  Форвард-миграция без down-файла делает АВТОМАТИЧЕСКИЙ откат СХЕМЫ БД невозможным."
    warn "  Если релиз, с которого откатываемся, содержал ALTER существующей таблицы —"
    warn "  требуется РУЧНОЕ вмешательство DBA (чистый CREATE TABLE новой сущности без down —"
    warn "  безопасен для отката кода: старый код просто не знает о новой таблице, SRS-NFR-063)."
    warn "  Это предупреждение печатается ДО отката кода приложения ниже."
    warn "=================================================================================="
  fi
fi

# --- (2) откат кода api/worker -------------------------------------------------------------------
log "откат: api/worker -> тег ${PREVIOUS_IMAGE_TAG}"
export IMAGE_TAG="$PREVIOUS_IMAGE_TAG"
export API_IMAGE="${IMAGE_REPOSITORY_API}:${PREVIOUS_IMAGE_TAG}"
export WORKER_IMAGE="${IMAGE_REPOSITORY_WORKER}:${PREVIOUS_IMAGE_TAG}"

if ! dc up -d --no-deps --wait api worker; then
  err "откат НЕ завершился здоровым состоянием api/worker на теге ${PREVIOUS_IMAGE_TAG} — требуется ручное вмешательство"
  exit 1
fi

log "ИТОГ: откат к тегу ${PREVIOUS_IMAGE_TAG} завершён, api/worker healthy"
