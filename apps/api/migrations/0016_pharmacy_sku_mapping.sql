-- =============================================================================
-- 0016_pharmacy_sku_mapping.sql — EP-05 (DTJ-146, SRS-INV-021..023)
-- =============================================================================
-- Кэш «однажды сматченного» — таблица связей (pharmacy, internal_sku) →
-- medicine. Используется `CompositeInventoryMatcherService` (DTJ-146)
-- для раннего выхода в уже разрешённых строках, БЕЗ обращения к
-- `medicines`.
--
--   - `matched_via` ∈ {'barcode','name_fuzzy','manual_resolve'} — для
--     аудита модерации и для отладки качества fuzzy-матчинга.
--   - UNIQUE `(pharmacy_id, internal_sku)` — гарантирует идемпотентность
--     `INSERT ... ON CONFLICT DO UPDATE` (SRS-INV-023).
--   - `medicine_id ON DELETE RESTRICT` — нельзя удалить medicine, пока
--     на него висят ссылки из кэша (должна быть блокировка на уровне
--     inventory-эпика, см. DTJ-152 watchdog).
-- =============================================================================

CREATE TABLE IF NOT EXISTS pharmacy_sku_mapping (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id     UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
    internal_sku    VARCHAR(64) NOT NULL,
    medicine_id     UUID NOT NULL REFERENCES medicines(id) ON DELETE RESTRICT,
    matched_via     VARCHAR(16) NOT NULL,
    matched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    note            TEXT,
    CONSTRAINT ux_pharmacy_sku_mapping_pharmacy_sku
        UNIQUE (pharmacy_id, internal_sku),
    CONSTRAINT chk_pharmacy_sku_mapping_matched_via
        CHECK (matched_via IN ('barcode','name_fuzzy','manual_resolve'))
);

-- Дополнительный индекс по `medicine_id` — для обратного запроса
-- «по какому SKU эта аптека продаёт этот medicine» (SRS-INV-052 п.2,
-- вторичные кейсы отчётов).
CREATE INDEX IF NOT EXISTS ix_pharmacy_sku_mapping_medicine
    ON pharmacy_sku_mapping (medicine_id);
