-- Down-миграция для 0053_courier_earnings_payouts.sql (EP-13, DTJ-321).
-- Обратный порядок: courier_earnings (ребёнок по FK на courier_payouts) перед courier_payouts,
-- затем enum. ВНИМАНИЕ: DROP TYPE упадёт, если в схеме остались колонки этого типа (тот же
-- принцип, что 0042_delivery_module_schema.down.sql).

DROP INDEX IF EXISTS ix_courier_earnings_courier;
DROP INDEX IF EXISTS ix_courier_earnings_courier_unpaid;
DROP TABLE IF EXISTS courier_earnings;

DROP INDEX IF EXISTS ix_courier_payouts_courier;
DROP TABLE IF EXISTS courier_payouts;

DROP TYPE IF EXISTS "courier_payout_batch_status";
