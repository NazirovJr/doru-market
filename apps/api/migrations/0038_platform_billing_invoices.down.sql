-- Обратная миграция 0038_platform_billing_invoices.
DROP INDEX IF EXISTS ix_orders_cash_delivered;
DROP TABLE IF EXISTS platform_billing_invoices;
DROP TYPE IF EXISTS "billing_invoice_status";
DROP TYPE IF EXISTS "billing_invoice_type";
