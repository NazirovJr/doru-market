-- Down-миграция для 0031_app_role_privileges.sql.
--
-- Порядок обратный зависимостям: сначала снять ALTER DEFAULT PRIVILEGES (иначе они переживут
-- DROP ROLE как осиротевшая запись в pg_default_acl), затем REVOKE явных прав на существующие
-- объекты, затем REVOKE CONNECT/USAGE, и только потом DROP ROLE.
--
-- Идемпотентно: весь блок обёрнут в проверку `IF EXISTS (... pg_roles ...)` — повторный прогон
-- на уже отсутствующей роли не бросает ошибку ("role app_role does not exist" при голом REVOKE
-- FROM app_role), файл безопасно применяется дважды подряд.
--
-- ВНИМАНИЕ (тот же класс оговорки, что 0029_payments.down.sql про DROP TYPE): роли в PostgreSQL
-- кластерные, не per-database. Если `app_role` получила привилегии ЕЩЁ в какой-то другой базе
-- этого кластера (например, кто-то применил 0031 и на `dorutj`, и на `dorutj_test2`), DROP ROLE
-- здесь упадёт с "role app_role cannot be dropped because some objects depend on it" — сначала
-- нужно откатить эту же миграцию во ВСЕХ базах кластера, где она применялась.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE dorutj_migrator IN SCHEMA public '
         || 'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app_role';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE dorutj_migrator IN SCHEMA public '
         || 'REVOKE USAGE, SELECT ON SEQUENCES FROM app_role';

    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_role';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM app_role';
    EXECUTE 'REVOKE USAGE ON SCHEMA public FROM app_role';
    EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM app_role', current_database());

    EXECUTE 'DROP ROLE app_role';
  END IF;
END
$$;
