-- Down-миграция для 0058_audit_action_category_pharmacy_terminal.sql (EP-12, DTJ-309).
-- НАМЕРЕННЫЙ NO-OP: PostgreSQL не поддерживает `ALTER TYPE ... DROP VALUE` — тот же вывод,
-- что уже зафиксирован для 0010/0043/0054/0056.
SELECT 1;
