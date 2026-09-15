-- Обратная миграция 0044_inventory_sync_errors_add_excel_codes.
-- ВНИМАНИЕ: откатывать только если ни одна строка не использует новые коды —
-- иначе ALTER TABLE ... ADD CONSTRAINT ниже упадёт на существующих данных.
ALTER TABLE inventory_sync_errors
    DROP CONSTRAINT IF EXISTS chk_inventory_sync_errors_error_code;

ALTER TABLE inventory_sync_errors
    ADD CONSTRAINT chk_inventory_sync_errors_error_code
        CHECK (error_code IN (
            'invalid_price',
            'invalid_quantity',
            'expires_at_invalid',
            'barcode_invalid',
            'medicine_not_found',
            'unmatched_medicine',
            'duplicate_in_batch'
        ));
