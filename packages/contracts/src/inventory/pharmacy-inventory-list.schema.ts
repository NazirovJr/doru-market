// Один элемент = один лот pharmacy_inventory, не агрегат по медикаменту. Свой дефолт
// limit=50 — не .extend() cursorQuerySchema (там дефолт 20 — часть её контракта).
import { z } from 'zod'

const MIN_LIMIT = 1
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

export const pharmacyInventoryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(MIN_LIMIT).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().optional(),
  'filter[q]': z.string().trim().min(1).optional(),
})
export type PharmacyInventoryListQuery = z.infer<typeof pharmacyInventoryListQuerySchema>

export const PharmacyInventoryItemSchema = z.object({
  inventoryId: z.string(),
  medicineId: z.string(),
  tradeName: z.string(),
  dosageForm: z.string(),
  dosageStrength: z.string(),
  priceDiram: z.number().int().nonnegative(),
  stockQuantity: z.number().int().nonnegative(),
  batchNumber: z.string().nullable(),
  expiryDate: z.string(),
  lastSyncedAt: z.string(),
})
export type PharmacyInventoryItemDto = z.infer<typeof PharmacyInventoryItemSchema>

export const PharmacyInventoryListPageSchema = z.object({
  items: z.array(PharmacyInventoryItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
})
export type PharmacyInventoryListPageDto = z.infer<typeof PharmacyInventoryListPageSchema>
