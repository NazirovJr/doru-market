-- Down-миграция для 0029_payments.sql (DTJ-236).
-- Обратный порядок относительно зависимостей FK: payment_operations/platform_fee/
-- payout_schedule/escrow_ledger (все ссылаются на orders, не друг на друга — порядок между
-- собой не важен, но таблицы обязаны уйти раньше enum'ов, которые они используют), затем
-- enum'ы payment_operation_status/payment_operation_type/payout_status/
-- escrow_entry_direction/escrow_entry_type.
-- ВНИМАНИЕ: DROP TYPE упадёт, если в схеме остались колонки этого типа (тот же принцип, что
-- 0023_orders_cart.down.sql/0002_enums.down.sql).

DROP TABLE IF EXISTS payment_operations;
DROP TABLE IF EXISTS platform_fee;
DROP TABLE IF EXISTS payout_schedule;
DROP TABLE IF EXISTS escrow_ledger;

DROP TYPE IF EXISTS "payment_operation_status";
DROP TYPE IF EXISTS "payment_operation_type";
DROP TYPE IF EXISTS "payout_status";
DROP TYPE IF EXISTS "escrow_entry_direction";
DROP TYPE IF EXISTS "escrow_entry_type";
