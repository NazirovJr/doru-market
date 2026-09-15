/**
 * Zod-схемы `POST /api/v1/inventory-excel-import` (EP-05, DTJ-161, SRS-INV-014).
 *
 * Тело — `multipart/form-data` (файл `.xlsx`/`.csv` + поле `mode`), НЕ JSON — сам файл НЕ
 * Zod-валидируется здесь (бинарные байты, парсинг — `ExcelInventoryParserPort`, DTJ-160).
 * `inventoryExcelImportModeSchema` валидирует ТОЛЬКО текстовое поле формы `mode`.
 */
import { z } from 'zod'

/**
 * `append_update` — N независимых delta-батчей (обычный докупка/обновление остатков).
 * `full_replace` — N батчей ОДНОЙ full-sync сессии (SRS-INV-014, «Полная замена ассортимента»,
 * чекбокс UI DTJ-168) — обнуление отсутствующих позиций после последнего батча (DTJ-151).
 */
export const inventoryExcelImportModeSchema = z.enum(['append_update', 'full_replace'])
export type InventoryExcelImportMode = z.infer<typeof inventoryExcelImportModeSchema>

/** Ответ `202 Accepted` (DTJ-161 п.7). */
export interface InventoryExcelImportAcceptedResponse {
  readonly sourceUploadId: string
  readonly totalBatches: number
  readonly totalRows: number
  readonly rejectedByParser: number
}
