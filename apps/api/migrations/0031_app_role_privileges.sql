-- =====================================================================================
-- 0031_app_role_privileges.sql — внеплановая задача (не тикет DTJ-*, поручение CTO по итогам
-- приёмки EP-10): SRS-DB-024/030 физически не выполнены — роль `app_role` нигде не создавалась,
-- `GRANT`/`REVOKE` не встречались ни в одной миграции, права существовали только как проза в
-- COMMENT ON TABLE (0005_outbox.sql, 0029_payments.sql) и как best-effort условный блок
-- 0030_escrow_ledger_grants.sql (DTJ-240) — тот блок сам содержит `IF EXISTS (... pg_roles ...)`
-- и остаётся no-op, пока роль не создана. Эта миграция создаёт роль и делает условие 0030
-- истинным при следующем прогоне на любой базе, где обе миграции применяются по порядку.
-- =====================================================================================
-- Номер сверен перед созданием: `ls apps/api/migrations/` и `meta/_journal.json` — последняя
-- запись в журнале `0030_escrow_ledger_grants` (idx 32, добавлена параллельным исполнителем
-- DTJ-240 ПОСЛЕ 0029_payments), следующий свободный — 0031.
--
-- Что делает:
--  1. Создаёт LOGIN-роль `app_role` (идемпотентно — `CREATE ROLE IF NOT EXISTS` не существует
--     в PostgreSQL, обёрнуто в DO-блок с проверкой `pg_roles`). Дев-пароль в духе принятого в
--     проекте (`dorutj_dev_only_password`, `dorutj_dev_redis_password`) — заведомо
--     непроизводственный, коммитить можно (правило 13 AGENTS.md).
--  2. `SELECT, INSERT, UPDATE, DELETE` на ВСЕ обычные таблицы схемы `public` + `USAGE, SELECT`
--     на все последовательности (SRS-DB-030).
--  3. Явное исключение append-only таблиц (SRS-DB-024): `escrow_ledger` получает только
--     `SELECT, INSERT` — `UPDATE, DELETE` явно отозваны ПОСЛЕ общего GRANT из пункта 2 (общий
--     GRANT выше выдаёт их по умолчанию, иначе таблица осталась бы с полным CRUD).
--     `audit_log` ЕЩЁ НЕ СУЩЕСТВУЕТ (придёт с EP-16) — блок ниже защищён `to_regclass(...)
--     IS NOT NULL`, поэтому сегодня для `audit_log` ничего не делает. Миграция EP-16,
--     создающая `audit_log`, ОБЯЗАНА сразу после `CREATE TABLE audit_log` выполнить
--     `REVOKE UPDATE, DELETE ON audit_log FROM app_role` — `ALTER DEFAULT PRIVILEGES` ниже
--     выдаёт КАЖДОЙ новой таблице полный CRUD одинаково, append-only — исключение, которое
--     обязана объявить сама создающая миграция (тот же паттерн, что и здесь для escrow_ledger).
--  4. `ALTER DEFAULT PRIVILEGES FOR ROLE dorutj_migrator` (самое важное — без этого блока
--     модель прав протухает в момент первой же новой таблицы следующей миграции: она появится
--     БЕЗ грантов `app_role`, приложение её не увидит). Действует на объекты, которые СОЗДАСТ
--     `dorutj_migrator` — реальная DDL-роль этого кластера (см. ниже про имя роли в SRS).
--
-- Роль-владелец существующих таблиц в этом кластере — `dorutj_migrator` (проверено:
-- `SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public'` — все 37 таблиц
-- `dorutj_test2` принадлежат `dorutj_migrator`). SRS-DB-030 называет DDL-роль `migrator_role` —
-- в реальной инфраструктуре (`infra/docker/docker-compose.yml` POSTGRES_USER, тестовые сьюты
-- `payments-migration.integration.spec.ts`) используется имя `dorutj_migrator` — расхождение
-- имени между спекой и практикой, не переименовываю самовольно (см. отчёт, раздел DISPUTED).
--
-- Идемпотентность (правило 11 AGENTS.md): `CREATE ROLE` — DO-блок с проверкой `pg_roles`.
-- `GRANT`/`REVOKE` идемпотентны нативно в PostgreSQL (повторное исполнение — no-op, тот же
-- итоговый набор привилегий, не бросает). `ALTER DEFAULT PRIVILEGES` тоже идемпотентно —
-- переустановка того же правила не дублирует эффект. Весь файл безопасно применяется дважды
-- подряд без ошибки.
-- =====================================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role WITH
      LOGIN
      PASSWORD 'dorutj_dev_app_role_password'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

-- CONNECT — явно, а не полагаясь на дефолт PUBLIC (в проде PUBLIC CONNECT может быть отозван,
-- см. `infra/docker/postgres-init/01-test-database.sql` для базы `dorutj`).
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_role', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO app_role;

-- Полный CRUD на все обычные таблицы (SRS-DB-030). Специальный случай escrow_ledger/audit_log
-- сужается ЯВНЫМ REVOKE в блоке ниже — иначе они получили бы столько же прав, сколько все
-- остальные таблицы, что и есть текущий (исправляемый этой миграцией) дефект.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;

-- Append-only на уровне привилегий роли (SRS-DB-024) — НЕ через триггер RAISE EXCEPTION
-- (спека прямо называет это избыточным дублированием). `to_regclass` — защита от таблицы,
-- которая ещё не существует (`audit_log`, EP-16), чтобы явный REVOKE на несуществующий объект
-- не уронил миграцию с "table does not exist".
DO $$
BEGIN
  IF to_regclass('public.escrow_ledger') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON public.escrow_ledger FROM app_role';
  END IF;
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON public.audit_log FROM app_role';
  END IF;
END
$$;

-- Дефолтные привилегии (см. header, п.4) — держат модель прав живой для ЛЮБОЙ таблицы/
-- последовательности, которую СОЗДАСТ dorutj_migrator в схеме public ПОСЛЕ этой миграции.
-- Новая append-only таблица (audit_log, EP-16 и далее) обязана СРАЗУ после CREATE TABLE явно
-- REVOKE UPDATE, DELETE FROM app_role — дефолт одинаков для всех таблиц, точечное сужение
-- по-прежнему на совести создающей миграции (задокументировано выше).
ALTER DEFAULT PRIVILEGES FOR ROLE dorutj_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;
ALTER DEFAULT PRIVILEGES FOR ROLE dorutj_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_role;
