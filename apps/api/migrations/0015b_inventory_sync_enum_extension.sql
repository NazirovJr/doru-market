-- =============================================================================
-- 0015b_inventory_sync_enum_extension.sql — EP-05 (DTJ-142, SRS-INV-014)
-- =============================================================================
-- Расширение enum `inventory_sync_row_error_code` значением `'processing_failed'`.
-- Этот файл ОБЯЗАН выполняться ОТДЕЛЬНЫМ SQL-подключением БЕЗ общей
-- транзакции (SRS-DB-009/049): PostgreSQL запрещает использовать новое
-- значение enum в той же транзакции, где оно добавлено (код `55P04`).
--
-- Раннер `apps/api/src/infrastructure/database/migrate.ts` обязан вызывать
-- этот файл отдельным `await db.execute(sql\`${content}\`)` минуя общий
-- `db.transaction(...)` (см. TODO в EP-19: поддержка `disable-transaction`
-- маркера для конкретных миграций).
--
-- ВНИМАНИЕ: значение `processing_failed` уже присутствует в Drizzle-схеме
-- (`apps/api/src/db/schema/enums.schema.ts`), но Drizzle Kit при `generate`
-- НЕ пересоздаёт тип — он только сверяет перечисление. Поэтому `ALTER TYPE
-- ... ADD VALUE IF NOT EXISTS` здесь обязательно (а не редактирование
-- `0002_enums.sql`, который уже применён).
--
-- IRREVERSIBLE: enum value addition в PostgreSQL не имеет нативного `DROP
-- VALUE` до v10. `down.sql` не создаётся намеренно.
-- =============================================================================

-- disable-transaction

ALTER TYPE inventory_sync_row_error_code ADD VALUE IF NOT EXISTS 'processing_failed';
