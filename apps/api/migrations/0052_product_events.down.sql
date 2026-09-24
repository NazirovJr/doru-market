-- Down-миграция для 0052_product_events.sql (DTJ-378).

DROP INDEX IF EXISTS idx_product_events_session;
DROP INDEX IF EXISTS idx_product_events_tenant_type_time;
DROP TABLE IF EXISTS product_events;
