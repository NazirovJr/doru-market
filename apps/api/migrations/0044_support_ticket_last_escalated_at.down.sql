-- Down-миграция для 0044_support_ticket_last_escalated_at.sql (DTJ-280).

DROP INDEX IF EXISTS ix_support_tickets_sla_escalation_scan;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS last_escalated_at;
