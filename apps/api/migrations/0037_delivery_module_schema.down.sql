-- Down-миграция для 0037_delivery_module_schema.sql (EP-13, DTJ-313).
-- Обратный порядок: cross-module orders ALTER первым (независим от остального), затем таблицы
-- (дети перед родителями по FK: delivery_offers/courier_shifts/courier_ratings перед
-- delivery_assignments/couriers; delivery_pricing_rules перед delivery_zones), деферренная FK на
-- orders.courier_id (падает вместе с couriers, явный DROP — для симметрии/явности), затем enum'ы.
-- ВНИМАНИЕ: DROP TYPE упадёт, если в схеме остались колонки этого типа (тот же принцип, что
-- 0029_payments.down.sql/0034_support_tickets_audit_log.down.sql).

ALTER TABLE orders DROP COLUMN IF EXISTS delivery_landmark_photo_url;
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_comment;
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_apartment;
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_floor;
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_entrance;

DROP TABLE IF EXISTS delivery_pricing_rules;
DROP INDEX IF EXISTS ix_delivery_zones_lat_lon;
DROP TABLE IF EXISTS delivery_zones;
DROP TABLE IF EXISTS courier_ratings;

DROP INDEX IF EXISTS ux_courier_shifts_one_active;
DROP TABLE IF EXISTS courier_shifts;

DROP INDEX IF EXISTS ix_delivery_offers_courier_pending;
DROP INDEX IF EXISTS ux_delivery_offers_one_pending_per_assignment;
DROP TABLE IF EXISTS delivery_offers;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_courier_id_fkey;

DROP INDEX IF EXISTS ux_delivery_assignment_one_active;
DROP INDEX IF EXISTS ix_delivery_assignments_courier_active;
DROP INDEX IF EXISTS ix_delivery_assignments_order;
DROP TABLE IF EXISTS delivery_assignments;

DROP INDEX IF EXISTS ix_couriers_active_chain;
DROP INDEX IF EXISTS ix_couriers_active_pool;
DROP TABLE IF EXISTS couriers;

DROP TYPE IF EXISTS "courier_shift_record_status";
DROP TYPE IF EXISTS "delivery_offer_status";
DROP TYPE IF EXISTS "courier_shift_status";
DROP TYPE IF EXISTS "delivery_assignment_status";
DROP TYPE IF EXISTS "courier_vehicle_type";
DROP TYPE IF EXISTS "courier_tax_status";
DROP TYPE IF EXISTS "courier_status";
