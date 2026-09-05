-- Down-миграция для 0040_support_ticket_sla_fields.sql (DTJ-278).
-- Обратный порядок: индекс/таблица support_ticket_messages (append-only, ссылается на
-- support_tickets — удаляется первой), затем колонки tenant_settings/support_tickets
-- (ALTER TABLE DROP COLUMN IF EXISTS — нативно идемпотентно).

DROP INDEX IF EXISTS ix_support_ticket_messages_ticket_created;
DROP TABLE IF EXISTS support_ticket_messages;

ALTER TABLE tenant_settings DROP COLUMN IF EXISTS support_first_response_sla_minutes;

ALTER TABLE support_tickets DROP COLUMN IF EXISTS priority;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS first_responded_at;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS first_response_due_at;
