#!/bin/sh
# apps/worker — точка входа контейнера. Без шага db:migrate (DTJ-002, шаг 7):
# apps/worker только читает БД, миграциями владеет apps/api (SRS-NFR-055).
set -e

exec "$@"
