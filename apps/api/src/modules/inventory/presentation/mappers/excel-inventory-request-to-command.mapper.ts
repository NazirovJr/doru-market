/**
 * Разбивка распарсенных строк Excel/CSV-импорта на батчи (EP-05, DTJ-161, SRS-INV-014).
 *
 * Чистые функции — тестируются НЕЗАВИСИМО от HTTP (DoD тикета п.6): `chunkRows` не знает
 * про `IngestRowInput`/`ExcelImportBatchPlan` вовсе, `buildExcelImportBatchPlans` не делает
 * I/O (генерация `batchId` — через инжектированный `generateBatchId`, не `randomUUID()`
 * внутри функции, тот же приём, что `Clock`-порт: рандом/время — параметром, не побочным
 * эффектом чистой функции).
 *
 * Режим `full_replace` (SRS-INV-014, чекбокс UI DTJ-168): ВСЕ N батчей получают ОДИН
 * `full_sync_session_id` (= `sourceUploadId`, см. риски тикета п.«Выбор одного UUID» —
 * решение принято: переиспользовать значение, а не заводить второй независимый UUID),
 * `isLastPage=true` — ТОЛЬКО на батче с наибольшим `pageNumber`(последний чанк). Режим
 * `append_update` — N независимых delta-батчей, `fullSyncSessionId=null` у каждого,
 * `isLastPage=true` у ВСЕХ (для delta это поле не несёт FSM-значения, см.
 * `InventorySyncBatch.isFullSyncLastPage`, но остаётся `true` как безопасный дефолт).
 */
import type { InventoryExcelImportMode } from '@dorutj/contracts'
import type { ParsedExcelRow } from '@/modules/inventory/application/ports/excel-inventory-parser.port.js'
import type { IngestRowInput } from '@/modules/inventory/application/use-cases/ingest-inventory-batch-with-matching.use-case.js'

export const EXCEL_IMPORT_CHUNK_SIZE = 1000

export interface ExcelImportBatchPlan {
  readonly batchId: string
  readonly pharmacyId: string
  readonly channel: 'excel'
  readonly syncType: 'delta' | 'full'
  readonly fullSyncSessionId: string | null
  readonly isLastPage: boolean
  readonly sourceUploadId: string
  readonly rows: readonly IngestRowInput[]
}

/** `chunkSize <= 0` возвращает `[]` (защита от бесконечного цикла на некорректном вызове). */
export function chunkRows<T>(rows: readonly T[], chunkSize: number): readonly (readonly T[])[] {
  if (rows.length === 0 || chunkSize <= 0) return []
  const chunks: T[][] = []
  for (let start = 0; start < rows.length; start += chunkSize) {
    chunks.push(rows.slice(start, start + chunkSize))
  }
  return chunks
}

/** Один распарсенный ряд (DTJ-160, примитивы) → `IngestRowInput` — ВСЕ Excel-строки unresolved (матчинг в use case). */
export function toIngestRowInput(row: ParsedExcelRow, rowIndexInBatch: number): IngestRowInput {
  return {
    rowIndex: rowIndexInBatch,
    internalSku: row.internalSku,
    rawBarcode: row.rawBarcode,
    rawTradeName: row.rawTradeName,
    rawDosageForm: row.rawDosageForm,
    rawDosageStrength: row.rawDosageStrength,
    rawManufacturerName: row.rawManufacturerName,
    priceDiram: row.priceDiram,
    quantity: row.quantity,
    expiresAtIso: row.expiresAtIso,
    batchNumber: row.batchNumber,
    resolved: false,
    resolvedMedicineId: null,
  }
}

export function buildExcelImportBatchPlans(input: {
  readonly parsedRows: readonly ParsedExcelRow[]
  readonly pharmacyId: string
  readonly mode: InventoryExcelImportMode
  readonly sourceUploadId: string
  readonly generateBatchId: () => string
}): readonly ExcelImportBatchPlan[] {
  const chunks = chunkRows(input.parsedRows, EXCEL_IMPORT_CHUNK_SIZE)
  const isFullReplace = input.mode === 'full_replace'
  const lastChunkIndex = chunks.length - 1
  return chunks.map((chunk, chunkIndex) => ({
    batchId: input.generateBatchId(),
    pharmacyId: input.pharmacyId,
    channel: 'excel' as const,
    syncType: isFullReplace ? ('full' as const) : ('delta' as const),
    fullSyncSessionId: isFullReplace ? input.sourceUploadId : null,
    isLastPage: isFullReplace ? chunkIndex === lastChunkIndex : true,
    sourceUploadId: input.sourceUploadId,
    rows: chunk.map((row, rowIndexInBatch) => toIngestRowInput(row, rowIndexInBatch)),
  }))
}
