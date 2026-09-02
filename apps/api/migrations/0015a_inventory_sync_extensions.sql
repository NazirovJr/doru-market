-- =============================================================================
-- 0015a_inventory_sync_extensions.sql — EP-05 (DTJ-142, SRS-INV-005/014/027/028/034/035)
-- =============================================================================
-- Расширения схемы для многоканального приёма остатков, дословно по
-- `docs/spec/22-module-inventory-sync-1c.md` §10 «Дополнения к схеме БД»:
--
--   1. `inventory_sync_batch` +`full_sync_session_id UUID`,
--      +`page_number INT DEFAULT 1`, +`is_last_page BOOLEAN DEFAULT true`,
--      +`source_upload_id UUID`, +`sync_type VARCHAR(8) DEFAULT 'delta'`,
--      +CHECK `chk_sync_batches_session_only_for_full`,
--      +индекс `ix_inventory_sync_batch_session`.
--
--   2. Новая таблица `inventory_sync_raw_items` (промежуточное хранилище
--      payload до воркера, `ON DELETE CASCADE` от `inventory_sync_batch`).
--
--   3. Новая таблица `catalog_match_queue` (владение будущего moderation-
--      эпика, см. README EP-05; EP-05 создаёт первым, т.к. без неё
--      `IngestInventoryBatchUseCase` (DTJ-148) физически не может выполнить
--      SRS-INV-028 «нерезолв → очередь модерации»).
--
--   4. Новая таблица `pharmacy_api_keys` (HMAC-ключи для 1С/ERP-канала,
--      SRS-ADM-043..046; CRUD — EP-03, владение — это `infrastructure` БД).
--
--   5. Дополнительный CHECK `chk_pharmacy_api_keys_exactly_one_scope` —
--      «ровно один скоуп заполнен» (pharmacy XOR chain).
--
-- [ИЗМЕНЕНО] 0015b удалена: она делала `ALTER TYPE inventory_sync_row_error_code
-- ADD VALUE 'processing_failed'`, но `CREATE TYPE` для этого типа не существует
-- ни в одной миграции (таблица `inventory_sync_errors` тоже нигде не создаётся,
-- drizzle-адаптера для неё нет — appendErrors реализован только in-memory).
-- Источник истины по кодам ошибок строк — TS-юнион
-- InventorySyncRowError['errorCode'] (inventory-sync-batch.repository.port.ts).
-- Таблица inventory_sync_errors появится вместе с drizzle-адаптером (DTJ-145)
-- по конвенции соседней 0012_inventory_foundation.sql — VARCHAR + CHECK, а не
-- pg enum.
--
-- Применяется ПОСЛЕ `0007_inventory.sql` (DTJ-141) и после создания
-- `pharmacy_chains` (0008_onboarding_foundation.sql) — оба этих файла
-- уже применены к моменту этого тикета.
-- =============================================================================

-- 1. Расширения `inventory_sync_batch` -------------------------------------------------
ALTER TABLE inventory_sync_batch
    ADD COLUMN IF NOT EXISTS sync_type         VARCHAR(8)  NOT NULL DEFAULT 'delta',
    ADD COLUMN IF NOT EXISTS full_sync_session_id UUID,
    ADD COLUMN IF NOT EXISTS page_number       INTEGER     NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_last_page      BOOLEAN     NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS source_upload_id  UUID;

-- CHECK «session_id заполняется ТОЛЬКО для full» (SRS-INV-005)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_sync_batches_session_only_for_full'
    ) THEN
        ALTER TABLE inventory_sync_batch
            ADD CONSTRAINT chk_sync_batches_session_only_for_full
            CHECK (
                (sync_type = 'full' AND full_sync_session_id IS NOT NULL)
                OR (sync_type = 'delta' AND full_sync_session_id IS NULL)
            );
    END IF;
END
$$;

-- CHECK «page_number ≥ 1»
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_sync_batches_page_number_positive'
    ) THEN
        ALTER TABLE inventory_sync_batch
            ADD CONSTRAINT chk_sync_batches_page_number_positive
            CHECK (page_number >= 1);
    END IF;
END
$$;

-- Индекс для запросов всех страниц одной full-сессии (DTJ-152 watchdog).
CREATE INDEX IF NOT EXISTS ix_inventory_sync_batch_session
    ON inventory_sync_batch (full_sync_session_id, page_number)
    WHERE full_sync_session_id IS NOT NULL;

-- 2. Новая таблица `inventory_sync_raw_items` -----------------------------------------
CREATE TABLE IF NOT EXISTS inventory_sync_raw_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id     UUID NOT NULL REFERENCES inventory_sync_batch(id) ON DELETE CASCADE,
    -- Позиция строки в payload пачки (0-based). `ROW_NUMBER()` гарантирует
    -- монотонность внутри batch_id без ручного индексирования на стороне
    -- воркера (DTJ-154).
    row_index    BIGINT NOT NULL,
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot-path воркера: `WHERE batch_id = $1 ORDER BY row_index`.
CREATE INDEX IF NOT EXISTS ix_inventory_sync_raw_items_batch
    ON inventory_sync_raw_items (batch_id, row_index);

-- 3. Новая таблица `catalog_match_queue` ---------------------------------------------
-- Координация с `moderation`-эпиком: см. README EP-05 §«Кросс-эпиковые
-- зависимости» и `apps/api/src/db/schema/catalog-match-queue.ts` (Drizzle).
-- EP-05 создаёт первым, потому что без неё невозможно выполнить
-- SRS-INV-028 (нерезолв строки → запись в очередь).
CREATE TABLE IF NOT EXISTS catalog_match_queue (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id              UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
    -- FK на каталог: nullable (нерезолв — кандидат не найден).
    -- `ON DELETE SET NULL` — при удалении medicine запись остаётся, но
    -- FK снимается (нельзя удалять catalog, пока на него висят очереди).
    medicine_id              UUID REFERENCES medicines(id) ON DELETE SET NULL,
    status                   VARCHAR(16) NOT NULL DEFAULT 'pending',
    raw_barcode              VARCHAR(64),
    raw_trade_name           VARCHAR(255) NOT NULL,
    raw_dosage_form          VARCHAR(64),
    raw_dosage_strength      VARCHAR(64),
    raw_manufacturer_name    VARCHAR(255),
    -- DTJ-142 п.3: 5 колонок, специфичных для inventory-канала.
    raw_stock_quantity       INTEGER,
    raw_expiry_date          DATE,
    raw_batch_number         VARCHAR(100),
    source_batch_id          UUID REFERENCES inventory_sync_batch(id) ON DELETE SET NULL,
    source_sync_timestamp    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_catalog_match_queue_status
        CHECK (status IN ('pending','resolved','rejected'))
);

-- Hot-path модератора: «список pending ORDER BY created_at».
CREATE INDEX IF NOT EXISTS ix_catalog_match_queue_status
    ON catalog_match_queue (status, created_at);
CREATE INDEX IF NOT EXISTS ix_catalog_match_queue_pharmacy
    ON catalog_match_queue (pharmacy_id);

-- 4. Новая таблица `pharmacy_api_keys` ------------------------------------------------
-- Координация с `onboarding`-эпиком (EP-03, DTJ-064+, SRS-ADM-043..046):
-- EP-03 владеет CRUD-эндпоинтами ключей и UI выдачи. EP-05 (этот тикет)
-- создаёт таблицу, т.к. `PharmacyApiKeyGuard` (DTJ-156) уже в скоупе EP-05.
CREATE TABLE IF NOT EXISTS pharmacy_api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- DTJ-142 п.4: `pharmacy_id` и `chain_id` оба NULLABLE. CHECK ниже
    -- гарантирует «ровно одно заполнено».
    pharmacy_id  UUID REFERENCES pharmacies(id) ON DELETE CASCADE,
    chain_id     UUID REFERENCES pharmacy_chains(id) ON DELETE CASCADE,
    -- Хеш секрета. `key_prefix` — для отображения оператору
    -- (`dorutj_xxxx...`). Полный секрет НИКОГДА не хранится.
    key_hash     VARCHAR(255) NOT NULL,
    key_prefix   VARCHAR(16)  NOT NULL,
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    note         TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 5. CHECK «ровно один скоуп заполнен» (DTJ-142 п.4) ----------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_pharmacy_api_keys_exactly_one_scope'
    ) THEN
        ALTER TABLE pharmacy_api_keys
            ADD CONSTRAINT chk_pharmacy_api_keys_exactly_one_scope
            CHECK (
                (pharmacy_id IS NOT NULL AND chain_id IS NULL)
                OR (pharmacy_id IS NULL AND chain_id IS NOT NULL)
            );
    END IF;
END
$$;

-- Индексы для hot-path
CREATE INDEX IF NOT EXISTS ix_pharmacy_api_keys_active
    ON pharmacy_api_keys (is_active);
CREATE INDEX IF NOT EXISTS ix_pharmacy_api_keys_pharmacy
    ON pharmacy_api_keys (pharmacy_id);
CREATE INDEX IF NOT EXISTS ix_pharmacy_api_keys_chain
    ON pharmacy_api_keys (chain_id);
