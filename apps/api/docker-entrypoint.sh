#!/bin/sh
# apps/api/docker-entrypoint.sh — DTJ-001, шаг 8.
#
# SRS-DB-032: применение миграций — ЕДИНСТВЕННО через этот скрипт в docker-контексте,
# выполняется ДО старта процесса (rolling-деплой ждёт успешного `GET /ready` на НОВОМ
# контейнере ПЕРЕД остановкой старого — docs/spec/31-nfr-security-testing-devops.md
# §«Миграции при деплое»).
#
# ЗАГЛУШКА (см. «Риски» тикета DTJ-001): реальные миграции появляются в DTJ-012. До тех пор
# `drizzle-kit migrate` не находит миграций (каталог `drizzle/` ещё не существует) и/или
# падает — это ожидаемо для этого тикета. DTJ-012 также обязан перепроверить доступность
# `drizzle-kit` в проде-образе: сейчас это `devDependency` (`apps/api/package.json`),
# `pnpm deploy --prod` (Dockerfile, стадия `deploy`) её не включает — до DTJ-012 команда
# ниже будет падать с «command not found», это ожидаемо и задокументировано.
set -e

./node_modules/.bin/drizzle-kit migrate

exec "$@"
