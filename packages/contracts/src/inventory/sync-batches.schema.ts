/**
 * Zod-схемы отчётности по батчам синхронизации остатков (EP-05, DTJ-158/163/164,
 * SRS-INV-008/043/044/045/046). Файл создан DTJ-158 (первый тикет из трёх, коснувшихся
 * этого файла), дополняется DTJ-163/164 (см. их JSDoc секции по мере добавления).
 *
 * `channel`/`status` ниже — ПРОПУСКАЮТСЯ КАК ЕСТЬ из домена (не транслируются):
 * `'rest'|'excel'|'manual'` — компактные значения, РЕАЛЬНО хранимые в
 * `inventory_sync_batch.channel` (CHECK-constraint, сверено с живой БД — см. JSDoc
 * `apps/api/src/db/schema/inventory-sync-batch.ts`). Это НЕ то же самое, что
 * `inventorySyncChannelSchema` из `batch-update.schema.ts`
 * (`'rest_api'|'excel_import'|'manual_entry'`, наименование из исходного текста
 * module 22) — та схема ни разу не используется ни одним полем реального запроса/ответа
 * (проверено: `inventoryBatchUpdateRequestSchema` не содержит `channel` вовсе). Вводить
 * здесь перевод `'rest'→'rest_api'` и т.п. без единого потребителя, который на него
 * полагается бы, — источник рассинхронизации без пользы; выбран прямой пропуск домена,
 * задокументирован явно, чтобы следующий ревьюер не считал это упущением.
 */
import { z } from 'zod'
import { inventorySyncTypeSchema } from './batch-update.schema.js'

export const inventorySyncBatchChannelSchema = z.enum(['rest', 'excel', 'manual'])
export type InventorySyncBatchChannelDto = z.infer<typeof inventorySyncBatchChannelSchema>

/** Полный набор статусов FSM (`apps/api/.../domain/inventory-sync-batch.entity.ts`, SRS-DOM-145..150). */
export const inventorySyncBatchStatusSchema = z.enum([
  'queued',
  'processing',
  'completed_full_success',
  'completed_partial_success',
  'failed_validation',
])
export type InventorySyncBatchStatusDto = z.infer<typeof inventorySyncBatchStatusSchema>

/**
 * Ответ `GET /api/v1/inventory-sync-batches/:batchId` (DTJ-158, SRS-INV-008) — статус
 * батча для поллинга 1С. `receivedAt`/`completedAt` — ISO-8601 строки (контроллер
 * конвертирует `Date` явно через `toISOString()`, не полагаясь на неявную сериализацию).
 */
export const InventorySyncBatchStatusResponseSchema = z.object({
  batchId: z.uuid(),
  status: inventorySyncBatchStatusSchema,
  channel: inventorySyncBatchChannelSchema,
  syncType: inventorySyncTypeSchema,
  totalRows: z.number().int().nonnegative(),
  acceptedRows: z.number().int().nonnegative(),
  rejectedRows: z.number().int().nonnegative(),
  receivedAt: z.string(),
  completedAt: z.string().nullable(),
})
export type InventorySyncBatchStatusResponse = z.infer<typeof InventorySyncBatchStatusResponseSchema>
