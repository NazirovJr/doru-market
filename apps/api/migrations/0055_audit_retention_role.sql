-- =====================================================================================
-- 0055_audit_retention_role.sql — DTJ-377: выделенная роль БД для AuditLogRetentionJob
-- (apps/worker), ЕДИНСТВЕННЫЙ санкционированный канал DELETE на append-only `audit_log`
-- (DTJ-374 `REVOKE UPDATE, DELETE ON audit_log FROM app_role` остаётся в силе — эта роль НЕ
-- `app_role`, она отдельная, обходит REVOKE намеренно и легитимно, см. `tickets/
-- ep09-admin-notify-analytics/DTJ-377.md` «Технический контекст»).
--
-- Номер/идемпотентность назначены координатором (idx 57, `meta/_journal.json`) — исполнитель
-- тикета не берёт номер миграции самостоятельно.
--
-- Минимальные привилегии (единственная дыра в append-only журнале — не давать сверх нужного
-- джобе): `SELECT, DELETE` ТОЛЬКО на `audit_log`. Ни `INSERT`/`UPDATE`, ни доступ к другим
-- таблицам, ни `ALTER DEFAULT PRIVILEGES` — в отличие от `app_role` (0031), эта роль не должна
-- автоматически получать права на будущие таблицы.
--
-- `CREATE ROLE` — DO-блок с проверкой `pg_roles` (та же идиома, что `0031_app_role_privileges.
-- sql`). `GRANT` идемпотентен нативно. Дев-пароль заведомо непроизводственный, коммитить можно
-- (правило 13 AGENTS.md).
-- =====================================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'audit_retention_role') THEN
    CREATE ROLE audit_retention_role WITH
      LOGIN
      PASSWORD 'dorutj_dev_audit_retention_password'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO audit_retention_role', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO audit_retention_role;
GRANT SELECT, DELETE ON audit_log TO audit_retention_role;
