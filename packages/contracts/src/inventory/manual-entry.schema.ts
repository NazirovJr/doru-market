/**
 * Zod-схемы `POST /api/v1/inventory-manual-entry` (EP-05, DTJ-162, SRS-INV-015/016).
 *
 * **Отклонение от буквального текста тикета — `priceTjs` НЕ `.positive()`.** Тикет приводит
 * `priceTjs: z.number().positive()` дословно в «Что сделать», но критерий приёмки 2 требует
 * ЧАСТИЧНОГО успеха: «80 строк, 3 из которых с priceTjs<=0 → 200 с acceptedRows=77,
 * rejectedRows=3». Zod `.positive()` на элементе МАССИВА отклоняет ВЕСЬ запрос целиком (400
 * ДО обработки), что делает частичный успех невозможным технически — прямое противоречие
 * между «Что сделать» и «Критерии приёмки» этого тикета. Разрешено в пользу критериев
 * приёмки (тестируемое поведение) — здесь `z.number()` (только тип), отрицательная цена
 * отклоняется ПОЗЖЕ, на уровне use case (`validateRowForDelta`, уже существующая проверка
 * `priceDiram < 0` → `invalid_price`, переиспользуется БЕЗ дублирования правила).
 */
import { z } from 'zod'

const MANUAL_ENTRY_MAX_ROWS = 1000
const BATCH_NUMBER_MAX_LENGTH = 100

/** `delete` — см. JSDoc маппера: минимальная интерпретация — `quantity` форсируется в `0` (нет отдельного domain-метода «удалить лот»). */
export const manualEntryOpSchema = z.enum(['upsert', 'delete'])
export type ManualEntryOp = z.infer<typeof manualEntryOpSchema>

export const manualEntryRowSchema = z.object({
  medicineId: z.uuid(),
  priceTjs: z.number(),
  quantity: z.number().int().min(0),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  batchNumber: z.string().max(BATCH_NUMBER_MAX_LENGTH).optional(),
  op: manualEntryOpSchema.default('upsert'),
})
export type ManualEntryRow = z.infer<typeof manualEntryRowSchema>

/** `.min(1)` — пустой массив отклоняется Zod-пайпом автоматически (АС4), контроллер не проверяет отдельно. */
export const manualEntryRequestSchema = z.object({
  rows: z.array(manualEntryRowSchema).min(1).max(MANUAL_ENTRY_MAX_ROWS),
})
export type ManualEntryRequest = z.infer<typeof manualEntryRequestSchema>

/** Одна построчная ошибка в ответе — та же форма, что `InventoryRowErrorDetail` (без `rawRow`, этот канал их не пишет). */
export interface ManualEntryRowErrorDto {
  readonly rowIndex: number
  readonly errorCode: string
  readonly reason: string
}

/** Ответ `200` (СИНХРОННЫЙ, финальный результат — не промежуточный `202`, см. JSDoc контроллера). */
export interface ManualEntryResponse {
  readonly batchId: string
  readonly status: string
  readonly acceptedRows: number
  readonly rejectedRows: number
  readonly errors: readonly ManualEntryRowErrorDto[]
}
