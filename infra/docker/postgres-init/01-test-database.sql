-- Тестовая роль/БД для интеграционных тестов apps/api (DTJ-181, DTJ-185, AGENTS.md Ж13).
--
-- Креды test/test — заведомо непроизводственные, локальные, коммитятся намеренно
-- (Ж13 прямо разрешает фиксировать тестовые ключи как заведомо непроизводственные).
-- Ожидается apps/api/vitest.integration.config.ts и test/integration/catalog/*.spec.ts:
--   postgres://test:test@localhost:5432/dorutj_test
--
-- Выполняется автоматически ТОЛЬКО при инициализации ПУСТОГО volume `pgdata`
-- (/docker-entrypoint-initdb.d — официальный механизм образа postgres). На уже существующем
-- volume этот файл не запустится — см. docs по ручному применению в отчёте задачи, применяющей
-- этот скрипт к работающему контейнеру через `psql -f`.
--
-- Роль test: NOSUPERUSER, без доступа к БД dorutj. Владеет dorutj_test и схемой public в ней,
-- поэтому может сама накатывать миграции в тестах (CREATE TABLE и т.п.), но не более.

DO
$$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'test') THEN
    CREATE ROLE test WITH LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION;
  END IF;
END
$$;

SELECT 'CREATE DATABASE dorutj_test OWNER test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'dorutj_test')\gexec

-- Владелец БД по умолчанию не становится владельцем схемы public (PostgreSQL 15+:
-- public принадлежит pg_database_owner физически, но фактическая запись под управлением
-- бутстрап-роли шаблона) — переустанавливаем явно, иначе тесты не смогут CREATE TABLE.
\c dorutj_test
ALTER SCHEMA public OWNER TO test;
GRANT ALL ON SCHEMA public TO test;

-- Изоляция: test не должен иметь доступа к рабочей БД dorutj (кластер общий для dev-стека).
REVOKE CONNECT ON DATABASE dorutj FROM PUBLIC;
