/**
 * Helpers для `IngestInventoryBatchWithMatchingUseCase` (DTJ-148).
 * Вынесены для соблюдения C2 (≤300 строк на файл) и C18 (helpers отдельно
 * от use case'а, проще читать высокоуровневую логику).
 */
import { ExpiryDate } from '@/shared-kernel/domain/value-objects/expiry-date.vo.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { NeedsFuzzyRow } from '../services/composite-inventory-matcher.service.js'
import type { InventorySyncRowError } from '../ports/inventory-sync-batch.repository.port.js'

/**
 * Определён ЗДЕСЬ (а не в `ingest-inventory-batch-with-matching.use-case.ts`,
 * который эти helpers обслуживает), чтобы избежать цикла `use-case ↔ helpers`
 * (depcruise `no-circular`) — use case ре-экспортирует тип оттуда, внешние
 * потребители не замечают перемещения.
 */
export interface IngestRowInput {
  readonly rowIndex: number
  readonly internalSku: string
  readonly rawBarcode: string | null
  readonly rawTradeName: string
  readonly rawDosageForm: string | null
  readonly rawDosageStrength: string | null
  readonly rawManufacturerName: string | null
  readonly priceDiram: bigint
  readonly quantity: number
  readonly expiresAtIso: string
  readonly batchNumber: string | null
  readonly resolved: boolean
  readonly resolvedMedicineId: string | null
}

export function toNeedsFuzzyRow(row: IngestRowInput): NeedsFuzzyRow {
  return {
    rowIndex: row.rowIndex,
    internalSku: row.internalSku,
    rawBarcode: row.rawBarcode,
    rawTradeName: row.rawTradeName,
    rawDosageForm: row.rawDosageForm,
    rawDosageStrength: row.rawDosageStrength,
    rawManufacturerName: row.rawManufacturerName,
  }
}

export function validateRowForDelta(row: IngestRowInput): {
  readonly code: 'invalid_price' | 'invalid_quantity' | 'expires_at_invalid'
  readonly reason: string
} | null {
  const MIN_PRICE_DIRAM = 0n

if (row.priceDiram < MIN_PRICE_DIRAM) {
    return {
      code: 'invalid_price',
      reason: `price cannot be negative: ${row.priceDiram.toString()}`,
    }
  }
  try {
    Money.fromDiram(row.priceDiram)
  } catch {
    return { code: 'invalid_price', reason: `price invalid: ${row.priceDiram.toString()}` }
  }
  if (!Number.isInteger(row.quantity) || row.quantity < 0) {
    return {
      code: 'invalid_quantity',
      reason: `quantity must be non-negative integer: ${String(row.quantity)}`,
    }
  }
  const expiry = ExpiryDate.parse(row.expiresAtIso)
  if (!expiry.ok) {
    return { code: 'expires_at_invalid', reason: expiry.error.message }
  }
  return null
}

export function buildRowError(input: {
  batchId: string
  rowIndex: number
  errorCode: InventorySyncRowError['errorCode']
  reason: string
}): InventorySyncRowError {
  return { ...input }
}
