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

-- immutable_unaccent: IMMUTABLE-обёртка над unaccent() с явным regdictionary.
-- unaccent(text) объявлена STABLE (зависит от текущего search_path/словаря по умолчанию),
-- поэтому недопустима в GENERATED ALWAYS AS ... STORED и в индексах по выражению
-- (Postgres требует IMMUTABLE — код ошибки 42P17). Явное указание словаря
-- 'public.unaccent'::regdictionary делает результат детерминированным для
-- фиксированного словаря — тот же словарь, что и раньше, просто без неявного резолвинга.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE EXTENSION IF NOT EXISTS btree_gin;
-- btree_gin: композитные GIN-индексы для составных условий
-- (например, поиск по `tenant_id` + `is_active` в одном индексе).
