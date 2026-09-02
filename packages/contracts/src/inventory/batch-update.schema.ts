/**
 * Zod-схемы для inventory REST-канала (EP-05, DTJ-157, SRS-INV-001..011).
 *
 * Контракт `POST /api/v1/inventory/batch-update` — дословно
 * `22-module-inventory-sync-1c.md` строки 124-147 (SRS-INV-002).
 * Лимиты проверяются на уровне Fastify-route (5MB bodyLimit +
 * `items.length<=1000`), здесь — структурная валидация.
 */
import { z } from 'zod'

/** Лимиты полей запроса `POST /api/v1/inventory/batch-update` (SRS-INV-002). */
const FIELD_MAX_LENGTH_SKU = 64
const FIELD_MAX_LENGTH_BARCODE = 32
const FIELD_MIN_LENGTH_BARCODE = 8
const FIELD_MAX_LENGTH_NAME = 256
const FIELD_MAX_LENGTH_NOTE = 512
const BATCH_MAX_ITEMS = 1000

/** Синхронный тип снапшота (SRS-INV-005). */
export const inventorySyncTypeSchema = z.enum(['delta', 'full'])
export type InventorySyncTypeDto = z.infer<typeof inventorySyncTypeSchema>

/** Канал (SRS-INV-006). Контроллер REST всегда `'rest_api'`. */
export const inventorySyncChannelSchema = z.enum(['rest_api', 'excel_import', 'manual_entry'])
export type InventorySyncChannelDto = z.infer<typeof inventorySyncChannelSchema>

/** Один элемент остатков (SRS-INV-002). */
export const inventoryBatchItemSchema = z.object({
  internal_sku: z.string().min(1).max(FIELD_MAX_LENGTH_SKU),
  raw_barcode: z
    .string()
    .min(FIELD_MIN_LENGTH_BARCODE)
    .max(FIELD_MAX_LENGTH_BARCODE)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  raw_trade_name: z.string().min(1).max(FIELD_MAX_LENGTH_NAME),
  raw_dosage_form: z.string().min(1).max(FIELD_MAX_LENGTH_SKU).nullable().optional(),
  raw_dosage_strength: z.string().min(1).max(FIELD_MAX_LENGTH_SKU).nullable().optional(),
  raw_manufacturer_name: z.string().min(1).max(FIELD_MAX_LENGTH_NAME).nullable().optional(),
  /** Цена в дирамах (целое). Конвертация из `tjs` — на стороне контроллера (SRS-INV-011). */
  price_diram: z.number().int().nonnegative(),
  quantity: z.number().int().nonnegative(),
  /** ISO date `YYYY-MM-DD`. */
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  batch_number: z.string().min(1).max(FIELD_MAX_LENGTH_SKU).nullable().optional(),
})
export type InventoryBatchItemDto = z.infer<typeof inventoryBatchItemSchema>

/**
 * Тело `POST /api/v1/inventory/batch-update` (SRS-INV-002).
 *
 * Refine (SRS-INV-005): `sync_type==='delta'` → `full_sync_session_id` запрещён;
 * `sync_type==='full'` → `full_sync_session_id` обязателен.
 */
export const inventoryBatchUpdateRequestSchema = z
  .object({
    batch_id: z.uuid(),
    sync_type: inventorySyncTypeSchema,
    full_sync_session_id: z.uuid().optional(),
    is_last_page: z.boolean().optional().default(true),
    note: z.string().max(FIELD_MAX_LENGTH_NOTE).optional(),
    items: z.array(inventoryBatchItemSchema).min(1).max(BATCH_MAX_ITEMS),
  })
  .superRefine((value, ctx) => {
    if (value.sync_type === 'delta' && value.full_sync_session_id !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['full_sync_session_id'],
        message: 'full_sync_session_id is only allowed for sync_type="full"',
      })
    }
    if (value.sync_type === 'full' && value.full_sync_session_id === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['full_sync_session_id'],
        message: 'full_sync_session_id is required for sync_type="full"',
      })
    }
  })
export type InventoryBatchUpdateRequest = z.infer<typeof inventoryBatchUpdateRequestSchema>

/** Ответ `202 Accepted` (SRS-INV-007). */
export interface InventoryBatchUpdateAcceptedResponse {
  readonly batchId: string
  readonly status: 'queued'
  readonly acceptedForProcessing: true
}
