// Мост apps/worker → IngestInventoryBatchWithMatchingUseCase (тот же use case, что REST-канал вызывает синхронно) —
// реконструирует rows из inventory_sync_raw_items, т.к. async job несёт только batchId.
import { Inject, Injectable } from '@nestjs/common'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
  type RawInventoryRow,
} from '../ports/inventory-sync-batch.repository.port.js'
import {
  IngestInventoryBatchWithMatchingUseCase,
  type IngestInventoryBatchResult,
  type IngestRowInput,
} from '../use-cases/ingest-inventory-batch-with-matching.use-case.js'

export interface ProcessInventorySyncBatchResult {
  readonly batchId: string
  readonly status: string
  readonly acceptedRows: number
  readonly rejectedRows: number
}

@Injectable()
export class ProcessInventorySyncBatchService {
  constructor(
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY)
    private readonly syncBatchRepository: InventorySyncBatchRepository,
    @Inject(IngestInventoryBatchWithMatchingUseCase)
    private readonly ingestBatch: IngestInventoryBatchWithMatchingUseCase,
  ) {}

  async process(batchId: string): Promise<ProcessInventorySyncBatchResult> {
    const batch = await this.syncBatchRepository.findById(batchId)
    if (batch === null) {
      throw new Error(`InventorySyncBatch ${batchId} not found`)
    }
    if (batch.isTerminal) {
      // Повторная доставка job'а после успешной обработки — не переигрывать, вернуть снимок как есть.
      return {
        batchId: batch.id,
        status: batch.status,
        acceptedRows: batch.acceptedRows,
        rejectedRows: batch.rejectedRows,
      }
    }
    const rawItems = await this.syncBatchRepository.findRawItems(batchId)
    const result: IngestInventoryBatchResult = await this.ingestBatch.execute({
      batchId: batch.id,
      pharmacyId: batch.pharmacyId,
      syncType: batch.syncType,
      fullSyncSessionId: batch.fullSyncSessionId,
      isLastPage: batch.isLastPage,
      rows: rawItems.map(rawItemToIngestRowInput),
    })
    return result
  }
}

/** `null`/`undefined` → `null`, иначе строковое представление (payload — JSONB, поля приходят как `string | number`). */
function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- payload собран этим же модулем (rowToPayload, persist-inventory-sync-batch.service.ts) — значение всегда string|number, никогда произвольный объект.
  return String(value)
}

/** Инверсия `rowToPayload` (`persist-inventory-sync-batch.service.ts`) — все поля unresolved, матчинг делает use case. */
function rawItemToIngestRowInput(rawItem: RawInventoryRow): IngestRowInput {
  const payload = rawItem.payload as Record<string, unknown>
  return {
    rowIndex: rawItem.rowIndex,
    internalSku: String(payload.internal_sku),
    rawBarcode: optionalString(payload.raw_barcode),
    rawTradeName: String(payload.raw_trade_name),
    rawDosageForm: optionalString(payload.raw_dosage_form),
    rawDosageStrength: optionalString(payload.raw_dosage_strength),
    rawManufacturerName: optionalString(payload.raw_manufacturer_name),
    priceDiram: BigInt(payload.price_diram as string | number),
    quantity: Number(payload.quantity),
    expiresAtIso: String(payload.expires_at),
    batchNumber: optionalString(payload.batch_number),
    resolved: false,
    resolvedMedicineId: null,
  }
}
