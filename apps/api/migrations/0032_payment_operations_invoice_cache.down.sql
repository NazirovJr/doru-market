-- Обратная миграция 0032_payment_operations_invoice_cache.
ALTER TABLE payment_operations DROP COLUMN IF EXISTS expires_at;
ALTER TABLE payment_operations DROP COLUMN IF EXISTS qr_payload;
