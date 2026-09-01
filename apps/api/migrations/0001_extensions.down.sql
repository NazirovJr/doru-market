-- 0001_extensions.down.sql (EP-01, DTJ-012).
-- Симметричный откат 0001_extensions.sql.
-- Обратный порядок (LIFO) — Postgres не имеет зависимостей между этими
-- расширениями, но симметрия с up-миграцией упрощает аудит.

DROP EXTENSION IF EXISTS btree_gin;
DROP EXTENSION IF EXISTS unaccent;
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS pgcrypto;
