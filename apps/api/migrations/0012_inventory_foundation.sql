-- =============================================================================
-- 0012_inventory_foundation.sql — EP-05 (DTJ-141, DTJ-144)
-- =============================================================================
-- Базовая DDL для модуля inventory:
--   - `pharmacy_inventory` — остатки по аптекам (FEFO-инвариант через UNIQUE);
--   - `inventory_sync_batch` — аудит-лог принятых синхронизаций.
--
-- CHECK-инварианты дублируют domain (`InventoryBatchUpsertRow`):
--   - price >= 0, quantity >= 0 (J7, D-13).
--   - channel ∈ {'manual','excel','rest'}, status ∈ {'received','processing',
--     'completed','failed'}.
--
-- Тенантный скоуп будет добавлен в EP-15 (RLS). FK на `users` для будущей
-- `received_by_user_id` — TODO(EP-01).
-- =============================================================================

CREATE TABLE IF NOT EXISTS pharmacy_inventory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id     UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
    medicine_id     UUID NOT NULL REFERENCES medicines(id) ON DELETE RESTRICT,
    price           INTEGER NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 0,
    expires_at      DATE NOT NULL,
    batch_number    VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_pharmacy_inventory_fefo
        UNIQUE (pharmacy_id, medicine_id, COALESCE(batch_number, ''), expires_at),
    CONSTRAINT chk_pharmacy_inventory_price_nonneg
        CHECK (price >= 0),
    CONSTRAINT chk_pharmacy_inventory_quantity_nonneg
        CHECK (quantity >= 0)
);

CREATE INDEX IF NOT EXISTS ix_pharmacy_inventory_by_medicine
    ON pharmacy_inventory (pharmacy_id, medicine_id);
CREATE INDEX IF NOT EXISTS ix_pharmacy_inventory_by_expiry
    ON pharmacy_inventory (pharmacy_id, expires_at);

CREATE TABLE IF NOT EXISTS inventory_sync_batch (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id     UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
    channel         VARCHAR(16) NOT NULL,
    status          VARCHAR(32) NOT NULL DEFAULT 'queued',
    total_rows      INTEGER NOT NULL DEFAULT 0,
    accepted_rows   INTEGER NOT NULL DEFAULT 0,
    rejected_rows   INTEGER NOT NULL DEFAULT 0,
    error_summary   JSONB,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    note            TEXT,
    CONSTRAINT chk_inventory_sync_batch_channel
        CHECK (channel IN ('manual','excel','rest')),
    CONSTRAINT chk_inventory_sync_batch_status
        CHECK (status IN ('queued','processing','completed_full_success','completed_partial_success','failed_validation'))
);

CREATE INDEX IF NOT EXISTS ix_inventory_sync_batch_pharmacy
    ON inventory_sync_batch (pharmacy_id, received_at);
CREATE INDEX IF NOT EXISTS ix_inventory_sync_batch_status
    ON inventory_sync_batch (status, received_at);
