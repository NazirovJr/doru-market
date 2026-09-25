-- Down-миграция для 0055_audit_retention_role.sql. Идемпотентно (IF EXISTS pg_roles).
-- Роли кластерные — если audit_retention_role получила права ещё в другой базе кластера,
-- DROP ROLE здесь упадёт (тот же class оговорки, что 0031_app_role_privileges.down.sql).

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'audit_retention_role') THEN
    EXECUTE 'REVOKE SELECT, DELETE ON audit_log FROM audit_retention_role';
    EXECUTE 'REVOKE USAGE ON SCHEMA public FROM audit_retention_role';
    EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM audit_retention_role', current_database());
    EXECUTE 'DROP ROLE audit_retention_role';
  END IF;
END
$$;
