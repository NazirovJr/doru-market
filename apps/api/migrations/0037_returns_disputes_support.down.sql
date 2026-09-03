-- Down-миграция для 0037_returns_disputes_support.sql (DTJ-270).
-- Обратный порядок зависимостей: сперва FK, добавленный ALTER TABLE поверх чужой таблицы
-- (payout_schedule принадлежит модулю payments, EP-10 — не эта миграция), затем таблицы,
-- ссылающиеся на order_disputes (dispute_status_history), затем сама order_disputes, затем
-- независимая order_returns, затем enum'ы. support_tickets/support_ticket_* — НЕ принадлежат
-- этой миграции (0034), здесь не трогаются.
-- ВНИМАНИЕ: DROP TYPE упадёт, если в схеме остались колонки этого типа (тот же принцип, что
-- 0029_payments.down.sql/0034_support_tickets_audit_log.down.sql).

ALTER TABLE payout_schedule DROP CONSTRAINT IF EXISTS fk_payout_schedule_dispute;

DROP INDEX IF EXISTS ux_order_disputes_one_active;
DROP INDEX IF EXISTS ux_order_returns_one_active;

DROP TABLE IF EXISTS dispute_status_history;
DROP TABLE IF EXISTS order_disputes;
DROP TABLE IF EXISTS order_returns;

DROP TYPE IF EXISTS "dispute_status";
DROP TYPE IF EXISTS "return_disposition";
DROP TYPE IF EXISTS "return_reason";
DROP TYPE IF EXISTS "return_status";
