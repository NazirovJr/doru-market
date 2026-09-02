-- 0021_seed_neutral_tenant.down.sql
-- Откат 0021_seed_neutral_tenant.sql.
-- ВНИМАНИЕ: удаление нейтрального тенанта возвращает систему в состояние дедлока
-- (см. JSDoc up-миграции) — использовать только если разворачиваете всю БД с нуля.

DELETE FROM tenant_settings WHERE tenant_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM tenants WHERE id = '00000000-0000-4000-8000-000000000001';
