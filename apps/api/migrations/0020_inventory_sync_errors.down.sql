-- Обратная миграция 0020_inventory_sync_errors.
DROP INDEX IF EXISTS ix_inventory_sync_errors_batch;
DROP TABLE IF EXISTS inventory_sync_errors;
