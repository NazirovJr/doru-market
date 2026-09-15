/**
 * `PersistInventorySyncBatchService` (EP-05, DTJ-161, DoD «вынести общую часть»).
 *
 * Общий шаг «создать батч + сырые строки + outbox-событие `queued`» для КАЖДОГО
 * асинхронного канала синхронизации остатков — вынесен из
 * `InventoryBatchUpdateController` (REST, DTJ-157) при появлении ВТОРОГО потребителя
 * (`InventoryExcelImportController`, DTJ-161, по N раз на чанк) — правило C15/DRY.
 * REST-контроллер отрефакторен на использование ЭТОГО сервиса тем же PR (DTJ-161 DoD).
 *
 * `manual_entry` (DTJ-162) НЕ использует этот сервис — намеренно: тот канал синхронный
 * (вызывает `IngestInventoryBatchWithMatchingUseCase.execute` напрямую в контроллере, БЕЗ
 * очереди, см. её JSDoc), публикация `queued`-события туда была бы семантически неверна
 * (батч уже терминален к моменту, когда гипотетический воркер мог бы его подхватить).
 *
 * Идемпотентность (SRS-INV-009): если `createIfNotExists` вернул `created=false` (повтор
 * `batchId`), `appendRawItems`/outbox-событие НЕ повторяются — тот же батч уже был
 * персистирован раньше.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { InventorySyncBatch } from '@/modules/inventory/domain/inventory-sync-batch.entity.js'
import type { InventorySyncChannel } from '@/modules/inventory/domain/inventory-sync.types.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
} from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'
import { INVENTORY_OUTBOX, type InventoryOutboxPort } from '@/modules/inventory/application/ports/inventory-outbox.port.js'
import type { IngestRowInput } from '@/modules/inventory/application/use-cases/ingest-inventory-batch-with-matching.use-case.js'

export interface PersistInventorySyncBatchInput {
  readonly batchId: string
  readonly pharmacyId: string
  readonly channel: InventorySyncChannel
  readonly syncType: 'delta' | 'full'
  readonly fullSyncSessionId: string | null
  readonly isLastPage: boolean
  readonly note: string | null
  readonly now: Date
  /** Группирующий UUID Excel-загрузки (DTJ-161/163/164) — `null`/omitted для каналов без группировки. */
  readonly sourceUploadId?: string | null
  readonly rows: readonly IngestRowInput[]
}

@Injectable()
export class PersistInventorySyncBatchService {
  constructor(
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY)
    private readonly syncBatchRepository: InventorySyncBatchRepository,
    @Inject(INVENTORY_OUTBOX) private readonly outbox: InventoryOutboxPort,
  ) {}

  async persistAndQueue(
    input: PersistInventorySyncBatchInput,
  ): Promise<{ readonly batch: InventorySyncBatch; readonly created: boolean }> {
    const { batch, created } = await this.syncBatchRepository.createIfNotExists({
      id: input.batchId,
      pharmacyId: input.pharmacyId,
      channel: input.channel,
      syncType: input.syncType,
      fullSyncSessionId: input.fullSyncSessionId,
      isLastPage: input.isLastPage,
      totalRows: input.rows.length,
      note: input.note,
      now: input.now,
      sourceUploadId: input.sourceUploadId ?? null,
    })
    if (!created) {
      return { batch, created }
    }
    await this.syncBatchRepository.appendRawItems(
      input.batchId,
      input.rows.map((row) => ({ rowIndex: row.rowIndex, payload: rowToPayload(row) })),
    )
    this.outbox.appendBatchQueued({
      eventType: 'inventory.sync_batch.queued',
      batchId: input.batchId,
      pharmacyId: input.pharmacyId,
      channel: input.channel,
      syncType: input.syncType,
    })
    return { batch, created }
  }
}

/** Тот же снапшот payload'а, что раньше держал `InventoryBatchUpdateController` (DTJ-157). */
function rowToPayload(row: IngestRowInput): Readonly<Record<string, unknown>> {
  return {
    internal_sku: row.internalSku,
    raw_barcode: row.rawBarcode,
    raw_trade_name: row.rawTradeName,
    raw_dosage_form: row.rawDosageForm,
    raw_dosage_strength: row.rawDosageStrength,
    raw_manufacturer_name: row.rawManufacturerName,
    price_diram: row.priceDiram.toString(),
    quantity: row.quantity,
    expires_at: row.expiresAtIso,
    batch_number: row.batchNumber,
  }
}
