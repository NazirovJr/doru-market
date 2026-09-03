-- Down-миграция для 0030_escrow_ledger_grants.sql (DTJ-240).
-- Точный реверс: возвращает app_role к правам, действовавшим ДО этой миграции (полный
-- DML-доступ, как остальные таблицы под SRS-DB-030) — тот же best-effort guard (роль может
-- не существовать в этом окружении, см. комментарий в 0030_escrow_ledger_grants.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    REVOKE INSERT, SELECT ON escrow_ledger FROM app_role;
    GRANT UPDATE, DELETE ON escrow_ledger TO app_role;
  END IF;
END $$;
