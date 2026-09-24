-- Down для 0053_courier_earnings_payouts.sql. Обратный порядок FK: courier_earnings перед courier_payouts.

DROP INDEX IF EXISTS ix_courier_earnings_courier;
DROP INDEX IF EXISTS ix_courier_earnings_courier_unpaid;
DROP TABLE IF EXISTS courier_earnings;

DROP INDEX IF EXISTS ix_courier_payouts_courier;
DROP TABLE IF EXISTS courier_payouts;

DROP TYPE IF EXISTS "courier_payout_batch_status";
