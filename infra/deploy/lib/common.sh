#!/usr/bin/env bash
# DoruTJ — общие хелперы логирования для infra/deploy/** (DTJ-428, EP-19).
# Владение: files_owned DTJ-428 (infra/deploy/**). Не самостоятельный скрипт — подключается
# через `source` из rolling-deploy.sh/rollback.sh/backup-restore-drill.sh.

log()  { printf '[deploy] %s\n' "$*"; }
warn() { printf '[deploy][WARN] %s\n' "$*" >&2; }
err()  { printf '[deploy][ERROR] %s\n' "$*" >&2; }
