-- Обратная миграция 0036_orders_payment_window_expires_at.
ALTER TABLE orders DROP COLUMN IF EXISTS payment_window_expires_at;
