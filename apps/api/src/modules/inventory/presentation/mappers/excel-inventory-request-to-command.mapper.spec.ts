/**
 * Тест чистых функций разбивки на батчи (EP-05, DTJ-161 DoD — «чистая функция,
 * тестируемая независимо от HTTP»). Поведение через контроллер — см.
 * `inventory-excel-import.controller.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { ParsedExcelRow } from '@/modules/inventory/application/ports/excel-inventory-parser.port.js'
import { buildExcelImportBatchPlans, chunkRows } from './excel-inventory-request-to-command.mapper.js'

function makeRow(rowIndex: number): ParsedExcelRow {
  return {
    rowIndex,
    internalSku: `SKU-${String(rowIndex)}`,
    rawBarcode: null,
    rawTradeName: 'Trade',
    rawDosageForm: null,
    rawDosageStrength: null,
    rawManufacturerName: null,
    priceDiram: 1000n,
    quantity: 1,
    expiresAtIso: '2028-01-01',
    batchNumber: null,
  }
}

describe('chunkRows (DTJ-161)', () => {
  it('пустой массив → []', () => {
    expect(chunkRows([], 1000)).toEqual([])
  })

  it('ровно кратно chunkSize → N полных чанков', () => {
    const rows = Array.from({ length: 3000 }, (_, i) => i)
    expect(chunkRows(rows, 1000).map((c) => c.length)).toEqual([1000, 1000, 1000])
  })

  it('с остатком → последний чанк короче', () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i)
    expect(chunkRows(rows, 1000).map((c) => c.length)).toEqual([1000, 1000, 500])
  })

  it('chunkSize <= 0 → [] (защита от бесконечного цикла)', () => {
    expect(chunkRows([1, 2, 3], 0)).toEqual([])
  })
})

describe('buildExcelImportBatchPlans (DTJ-161)', () => {
  it('append_update: fullSyncSessionId=null на каждом плане, rowIndex переиндексирован 0-based внутри чанка', () => {
    const parsedRows = Array.from({ length: 1200 }, (_, i) => makeRow(i))
    let counter = 0
    const plans = buildExcelImportBatchPlans({
      parsedRows,
      pharmacyId: 'PH-1',
      mode: 'append_update',
      sourceUploadId: 'UPLOAD-1',
      generateBatchId: () => `BATCH-${String((counter += 1))}`,
    })

    expect(plans).toHaveLength(2)
    expect(plans.every((p) => p.fullSyncSessionId === null)).toBe(true)
    expect(plans.every((p) => p.syncType === 'delta')).toBe(true)
    expect(plans.every((p) => p.isLastPage)).toBe(true)
    expect(plans[1]?.rows[0]?.rowIndex).toBe(0)
    expect(plans[0]?.batchId).toBe('BATCH-1')
    expect(plans[1]?.batchId).toBe('BATCH-2')
  })

  it('full_replace: fullSyncSessionId=sourceUploadId на всех, isLastPage=true только на последнем', () => {
    const parsedRows = Array.from({ length: 2200 }, (_, i) => makeRow(i))
    const plans = buildExcelImportBatchPlans({
      parsedRows,
      pharmacyId: 'PH-1',
      mode: 'full_replace',
      sourceUploadId: 'UPLOAD-2',
      generateBatchId: () => crypto.randomUUID(),
    })

    expect(plans).toHaveLength(3)
    expect(plans.every((p) => p.fullSyncSessionId === 'UPLOAD-2')).toBe(true)
    expect(plans.every((p) => p.syncType === 'full')).toBe(true)
    expect(plans.map((p) => p.isLastPage)).toEqual([false, false, true])
  })

  it('строки конструируются resolved=false, resolvedMedicineId=null (Excel-канал не резолвит сам)', () => {
    const plans = buildExcelImportBatchPlans({
      parsedRows: [makeRow(0)],
      pharmacyId: 'PH-1',
      mode: 'append_update',
      sourceUploadId: 'UPLOAD-3',
      generateBatchId: () => 'BATCH-1',
    })

    expect(plans[0]?.rows[0]).toMatchObject({ resolved: false, resolvedMedicineId: null, internalSku: 'SKU-0' })
  })
})
