-- Down-миграция для 0060_audit_action_category_pharmacy_settings.sql (DTJ-367).
-- НАМЕРЕННЫЙ NO-OP: PostgreSQL не поддерживает `ALTER TYPE ... DROP VALUE` — тот же вывод,
-- что уже зафиксирован для 0010/0043/0054/0056/0058.
SELECT 1;
