-- =============================================================================
-- 0020_inventory_sync_errors.sql — EP-05 (DTJ-145, SRS-INV-011)
-- =============================================================================
-- Построчные ошибки батча синхронизации остатков. Требование продукта:
-- один битый ряд (невалидная цена, нерезолв по каталогу, ...) не имеет
-- права уронить весь батч — остальные строки обязаны применяться, а
-- проблемная строка попадает СЮДА, чтобы аптека увидела её в кабинете
-- и исправила (не в `inventory_sync_batch.error_summary` — это агрегат,
-- не построчная детализация).
--
-- Источник истины по `error_code` — TS-юнион
-- `InventorySyncRowError['errorCode']`
-- (`apps/api/src/modules/inventory/application/ports/inventory-sync-batch.repository.port.ts`).
-- НЕ ссылаться на `docs/spec/11-database-schema.md` §12 — там другой,
-- устаревший набор значений (pg enum), заведший бы CHECK и код в
-- рассинхрон.
--
-- Конвенция VARCHAR + CHECK, а не pg enum — как соседняя
-- `inventory_sync_batch` (0012_inventory_foundation.sql): `ALTER TYPE ...
-- ADD VALUE` не транзакционен и уже давал проблему (см. удалённые
-- 0015b + pgEnum `inventory_sync_row_error_code`, зафиксировано в
-- 0015a_inventory_sync_extensions.sql).
--
-- FK `batch_id → inventory_sync_batch(id) ON DELETE CASCADE`: построчные
-- ошибки не имеют смысла без родительского батча; удаление батча
-- (например, watchdog зависших full-sync сессий, DTJ-152) забирает и
-- его ошибки.
-- =============================================================================

CREATE TABLE IF NOT EXISTS inventory_sync_errors (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id     UUID NOT NULL REFERENCES inventory_sync_batch(id) ON DELETE CASCADE,
    -- Позиция строки в исходном payload'е (0-based, тот же индекс, что
    -- `inventory_sync_raw_items.row_index`) — аптека видит "строка N".
    row_index    BIGINT NOT NULL,
    error_code   VARCHAR(32) NOT NULL,
    reason       TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_inventory_sync_errors_error_code
        CHECK (error_code IN (
            'invalid_price',
            'invalid_quantity',
            'expires_at_invalid',
            'barcode_invalid',
            'medicine_not_found',
            'unmatched_medicine',
            'duplicate_in_batch'
        ))
);

-- Hot-path кабинета аптеки: «список ошибок батча N, по порядку строк».
CREATE INDEX IF NOT EXISTS ix_inventory_sync_errors_batch
    ON inventory_sync_errors (batch_id, row_index);
