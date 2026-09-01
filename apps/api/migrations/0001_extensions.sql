-- 0001_extensions.sql (EP-01, DTJ-012, SRS-DB-007).
--
-- Включает PostgreSQL-расширения, требуемые последующими миграциями и приложением.
-- Применяется ПЕРВОЙ — все остальные миграции зависят от этих расширений
-- (например, `gen_random_uuid()` из `pgcrypto` используется в DEFAULT у PK).
--
-- `IF NOT EXISTS` — идемпотентность при повторном применении (drizzle-kit
-- отслеживает применённые миграции в `meta/_journal.json`, но защита
-- `IF NOT EXISTS` — дополнительный рубеж).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pgcrypto: gen_random_uuid() для DEFAULT PK (SRS-DB-001).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- pg_trgm: trigram-индексы для нечёткого поиска по названиям лекарств (EP-06).

CREATE EXTENSION IF NOT EXISTS unaccent;
-- unaccent: нормализация диакритики в поисковых запросах (EP-06).

CREATE EXTENSION IF NOT EXISTS btree_gin;
-- btree_gin: композитные GIN-индексы для составных условий
-- (например, поиск по `tenant_id` + `is_active` в одном индексе).
