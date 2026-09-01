-- =============================================================================
-- 0015a_inventory_sync_extensions.down.sql — EP-05 (DTJ-142, обратная миграция)
-- =============================================================================
-- Обратимая часть миграции 0015a. Не затрагивает enum-расширение
-- (0015b IRREVERSIBLE — см. комментарий в самом 0015b).
--
-- ВАЖНО: PostgreSQL не позволяет `DROP COLUMN` с зависимыми view / constraint
-- в одной транзакции, если constraint был `NOT NULL` без `DEFAULT`. Все
-- добавляемые колонки здесь — `NULL` или `DEFAULT`d, так что их удаление
-- безопасно.
-- =============================================================================

-- 1. Откат расширений `inventory_sync_batch`
ALTER TABLE inventory_sync_batch
    DROP CONSTRAINT IF EXISTS chk_sync_batches_session_only_for_full,
    DROP CONSTRAINT IF EXISTS chk_sync_batches_page_number_positive,
    DROP COLUMN IF EXISTS source_upload_id,
    DROP COLUMN IF EXISTS is_last_page,
    DROP COLUMN IF EXISTS page_number,
    DROP COLUMN IF EXISTS full_sync_session_id,
    DROP COLUMN IF EXISTS sync_type;

DROP INDEX IF EXISTS ix_inventory_sync_batch_session;

-- 2. Удаление `inventory_sync_raw_items` (CASCADE уберёт и constraint)
DROP TABLE IF EXISTS inventory_sync_raw_items;

-- 3. Удаление `catalog_match_queue` — координация с moderation-эпиком:
-- если он уже подключился и добавил свои поля/индексы, его миграция
-- должна быть ОТКАТНУТА отдельно (при координации). Этот down
-- удаляет таблицу ЦЕЛИКОМ — EP-05 владеет базовым DDL.
DROP TABLE IF EXISTS catalog_match_queue;

-- 4. Удаление `pharmacy_api_keys` — координация с onboarding-эпиком
-- (CRUD ключей — EP-03, владение БД-схемой — этот тикет).
DROP TABLE IF EXISTS pharmacy_api_keys;
