/**
 * Константы для DTJ-155 — failed-handler `inventory-sync-queue`.
 */
export const INVENTORY_SYNC_QUEUE_NAME = 'inventory-sync-queue'

/** `error_code='processing_failed'` (DTJ-142, миграция 0015b). */
export const ERROR_CODE_PROCESSING_FAILED = 'processing_failed'

/** Максимальная длина `error_detail` (защита БД от раздувания). */
export const MAX_ERROR_DETAIL_LENGTH = 4_000
