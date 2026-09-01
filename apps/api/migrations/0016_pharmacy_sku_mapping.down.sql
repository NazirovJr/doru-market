-- Обратная миграция 0016_pharmacy_sku_mapping.
DROP INDEX IF EXISTS ix_pharmacy_sku_mapping_medicine;
DROP TABLE IF EXISTS pharmacy_sku_mapping;
