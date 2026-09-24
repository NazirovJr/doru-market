// Контракт POST /api/v1/analytics/events (DTJ-379). eventType — НЕ z.enum: домен
// (product-event.entity.ts:PRODUCT_EVENT_TYPES) остаётся единственным источником истины,
// контракт пропускает ещё-неизвестные значения мимо себя (версионный рассинхрон клиент/сервер).
import { z } from 'zod'

const SESSION_ID_MAX_LENGTH = 128
const EVENT_TYPE_MAX_LENGTH = 50
const EVENTS_BATCH_MAX_SIZE = 50
const METADATA_MAX_JSON_LENGTH = 4096

export const ProductEventInputSchema = z.object({
  eventType: z.string().min(1).max(EVENT_TYPE_MAX_LENGTH),
  sessionId: z.string().min(1).max(SESSION_ID_MAX_LENGTH),
  medicineId: z.uuid().optional(),
  pharmacyId: z.uuid().optional(),
  savingsDiram: z.number().int().nonnegative().optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .refine((value) => value === undefined || JSON.stringify(value).length < METADATA_MAX_JSON_LENGTH, {
      message: `metadata JSON must be under ${String(METADATA_MAX_JSON_LENGTH)} characters`,
    }),
})

export type ProductEventInput = z.infer<typeof ProductEventInputSchema>

export const ProductEventsBatchSchema = z.array(ProductEventInputSchema).max(EVENTS_BATCH_MAX_SIZE)

export type ProductEventsBatchInput = z.infer<typeof ProductEventsBatchSchema>
