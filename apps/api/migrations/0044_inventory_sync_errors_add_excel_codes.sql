-- =============================================================================
-- 0044_inventory_sync_errors_add_excel_codes.sql — EP-05 (DTJ-160, SRS-INV-013)
-- =============================================================================
-- `XlsxExcelInventoryParserAdapter` (DTJ-160) отклоняет строки Excel/CSV-импорта
-- с кодами `ambiguous_date_format`/`missing_required_field` — оба уже
-- специфицированы (`docs/spec/11-database-schema.md` §11 п.166..168), но
-- РЕАЛЬНАЯ миграция 0020 (`inventory_sync_errors`) их не включала (список там
-- писался под REST/матчинг-конвейер DTJ-145/148, без учёта будущего Excel-
-- парсера). Расширяем CHECK, не меняя тип колонки (VARCHAR, не pg enum —
-- та же причина, что 0020/0015a: `ALTER TYPE ... ADD VALUE` не транзакционен).
--
-- Источник истины по значению — TS-юнион `InventorySyncRowError['errorCode']`
-- (`apps/api/src/modules/inventory/application/ports/inventory-sync-batch.repository.port.ts`),
-- CHECK обязан оставаться синхронным с ним (см. JSDoc той же миграции 0020).
-- =============================================================================

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
            'duplicate_in_batch',
            'ambiguous_date_format',
            'missing_required_field'
        ));
