-- Обратная миграция 0035_escrow_ledger_refund_unique.
DROP INDEX IF EXISTS ux_escrow_ledger_refunded_once;
