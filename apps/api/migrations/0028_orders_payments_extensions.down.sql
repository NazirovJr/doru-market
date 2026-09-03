-- Обратная миграция 0028_orders_payments_extensions.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_billing_strategy_values;
ALTER TABLE orders DROP COLUMN IF EXISTS billing_strategy;
