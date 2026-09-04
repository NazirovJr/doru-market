-- Обратная миграция 0037_pharmacy_terminal_schema (DTJ-300, EP-12). Порядок — строго обратный
-- порядку `up`: сперва зависимые констрейнты/колонки/таблицы, затем типы ENUM, на которые они
-- ссылаются (DROP TYPE падает, пока есть хоть одна колонка этого типа).

-- tenant_settings
ALTER TABLE tenant_settings DROP CONSTRAINT IF EXISTS chk_tenant_settings_pht_ranges;
ALTER TABLE tenant_settings DROP COLUMN IF EXISTS partial_fulfillment_confirmation_timeout_minutes;
ALTER TABLE tenant_settings DROP COLUMN IF EXISTS handover_otp_max_regenerations_per_order;
ALTER TABLE tenant_settings DROP COLUMN IF EXISTS handover_otp_regenerate_min_interval_seconds;

-- order_partial_fulfillment_requests (DROP TABLE снимает и её собственный индекс/CHECK/FK разом)
DROP TABLE IF EXISTS order_partial_fulfillment_requests;
DROP TYPE IF EXISTS partial_fulfillment_status;

-- order_items (DROP COLUMN снимает и одноколоночные CHECK, объявленные на этой же колонке)
ALTER TABLE order_items DROP COLUMN IF EXISTS fulfillment_status;
ALTER TABLE order_items DROP COLUMN IF EXISTS scanned_batch_id;
ALTER TABLE order_items DROP COLUMN IF EXISTS scanned_at;
ALTER TABLE order_items DROP COLUMN IF EXISTS scanned_by;
ALTER TABLE order_items DROP COLUMN IF EXISTS scan_method;
ALTER TABLE order_items DROP COLUMN IF EXISTS item_issue_reason;
DROP TYPE IF EXISTS order_item_fulfillment_status;

-- orders
ALTER TABLE orders DROP COLUMN IF EXISTS assigned_pharmacist_id;
