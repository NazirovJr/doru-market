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

-- ДОБАВЛЕНО DTJ-414 (найдено живым прогоном CI integration-tests job, не выдумано заранее):
-- заголовок этого файла (см. выше) предполагал, что `test` сам накатывает миграции (CREATE
-- TABLE) и потому автоматически владеет таблицами — но `apps/api/migrations/0031_app_role_
-- privileges.sql` (CREATE ROLE app_role, ALTER DEFAULT PRIVILEGES FOR ROLE dorutj_migrator)
-- требует CREATEROLE/роль-владение `dorutj_migrator`, которых у `test` (NOCREATEROLE) нет —
-- полный набор миграций объективно ОБЯЗАН идти под `dorutj_migrator` (реальной
-- DDL-суперпользовательской ролью кластера, POSTGRES_USER этого образа), не под `test`.
-- Без строк ниже `test` владеет только СХЕМОЙ public (`ALTER SCHEMA`/`GRANT ALL ON SCHEMA`
-- выше), но НЕ таблицами, которые в неё реально создаёт `dorutj_migrator` — живой прогон
-- integration-tests (DTJ-414) подтвердил: КАЖДЫЙ запрос под `test` падал с `permission denied
-- for table ...`. `ALTER DEFAULT PRIVILEGES FOR ROLE dorutj_migrator` — персистентное правило
-- в каталоге (не зависит от текущей сессии/подключения): применяется к ЛЮБОЙ таблице/
-- последовательности, которую `dorutj_migrator` создаст в этой БД ПОСЛЕ этого момента —
-- то есть ко всем 104+ миграциям `pnpm db:migrate`, выполненным позже. Тот же приём, что
-- 0031_app_role_privileges.sql уже применяет для `app_role` — здесь то же самое для `test`.
-- Соответствует известному предсуществующему разрыву тестовой инфраструктуры, отмеченному
-- (но не устранённому в периметре тех тикетов) в `docs/STATE-AND-RESUME-POINT.md`
-- («dorutj_test... support_tickets/audit_log в собственности роли dorutj_migrator, а не test»).
-- `TRUNCATE` — ОТДЕЛЬНАЯ привилегия в PostgreSQL, не входит в `SELECT, INSERT, UPDATE, DELETE`
-- (найдено ТЕМ ЖЕ живым прогоном: интеграционные тесты `test/integration/inventory/*`
-- используют `TRUNCATE <table> CASCADE` между тестами вместо `DELETE FROM`, `permission denied
-- for table ...` иначе — без явного перечисления `TRUNCATE` здесь предыдущие две строки её НЕ
-- покрывают).
ALTER DEFAULT PRIVILEGES FOR ROLE dorutj_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO test;
ALTER DEFAULT PRIVILEGES FOR ROLE dorutj_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO test;
