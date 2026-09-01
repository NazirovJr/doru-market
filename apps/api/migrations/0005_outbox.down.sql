-- 0005_outbox.down.sql (EP-01, DTJ-016).
-- Обратный откат 0005_outbox.sql.

DROP TABLE IF EXISTS "processed_events";
DROP INDEX IF EXISTS "outbox_pending_created_at_idx";
DROP TABLE IF EXISTS "outbox";
DROP TYPE IF EXISTS "outbox_status";
