// Application-слой не импортирует infrastructure — локальный Fake-репозиторий, use case заменён стабом {execute}.
import { describe, expect, it, vi } from 'vitest'
import { InventorySyncBatch } from '@/modules/inventory/domain/inventory-sync-batch.entity.js'
import type {
  CreateInventorySyncBatchInput,
  IncompleteFullSyncSession,
  InventorySyncBatchRepository,
  InventorySyncRowError,
  RawInventoryRow,
} from '../ports/inventory-sync-batch.repository.port.js'
import type { InventorySyncStatus } from '@/modules/inventory/domain/inventory-sync.types.js'
import type {
  IngestInventoryBatchResult,
  IngestInventoryBatchWithMatchingUseCase,
  IngestRowInput,
} from '../use-cases/ingest-inventory-batch-with-matching.use-case.js'
import { ProcessInventorySyncBatchService } from './process-inventory-sync-batch.service.js'

const PHARMACY_ID = '22222222-2222-2222-2222-222222222222'
const BATCH_ID = '44444444-4444-4444-4444-444444444444'

class FakeInventorySyncBatchRepository implements InventorySyncBatchRepository {
  private readonly batches = new Map<string, InventorySyncBatch>()
  private readonly rawItems = new Map<string, RawInventoryRow[]>()

  create(_input: CreateInventorySyncBatchInput): Promise<{ readonly id: string }> {
    throw new Error('not used in process-batch tests')
  }

  markStatus(_id: string, _status: InventorySyncStatus): Promise<void> {
    throw new Error('not used in process-batch tests')
  }

  findById(id: string): Promise<InventorySyncBatch | null> {
    return Promise.resolve(this.batches.get(id) ?? null)
  }

  save(batch: InventorySyncBatch): Promise<void> {
    this.batches.set(batch.id, batch)
    return Promise.resolve()
  }

  appendErrors(_errors: readonly InventorySyncRowError[]): Promise<void> {
    return Promise.resolve()
  }

  findRawItems(batchId: string): Promise<readonly RawInventoryRow[]> {
    return Promise.resolve(this.rawItems.get(batchId) ?? [])
  }

  createIfNotExists(): ReturnType<InventorySyncBatchRepository['createIfNotExists']> {
    throw new Error('not used in process-batch tests')
  }

  appendRawItems(): Promise<void> {
    throw new Error('not used in process-batch tests')
  }

  findIncompleteFullSyncSessions(_olderThanMinutes: number): Promise<readonly IncompleteFullSyncSession[]> {
    throw new Error('not used in process-batch tests')
  }

  findPharmacyChainId(_pharmacyId: string): Promise<string | null> {
    throw new Error('not used in process-batch tests')
  }

  findManyForReport(): ReturnType<InventorySyncBatchRepository['findManyForReport']> {
    throw new Error('not used in process-batch tests')
  }

  findRowErrorsByBatchId(): ReturnType<InventorySyncBatchRepository['findRowErrorsByBatchId']> {
    throw new Error('not used in process-batch tests')
  }

  findBySourceUploadId(): ReturnType<InventorySyncBatchRepository['findBySourceUploadId']> {
    throw new Error('not used in process-batch tests')
  }

  findPharmacyIdsWithActivitySince(): ReturnType<InventorySyncBatchRepository['findPharmacyIdsWithActivitySince']> {
    throw new Error('not used in process-batch tests')
  }

  /** TEST-ONLY. */
  seed(batch: InventorySyncBatch, rawItems: readonly RawInventoryRow[]): void {
    this.batches.set(batch.id, batch)
    this.rawItems.set(batch.id, [...rawItems])
  }
}

function makeQueuedBatch(): InventorySyncBatch {
  return InventorySyncBatch.create(
    { id: BATCH_ID, pharmacyId: PHARMACY_ID, channel: 'excel', syncType: 'delta', totalRows: 1 },
    new Date('2026-01-15T10:00:00.000Z'),
  )
}

const RAW_ITEM: RawInventoryRow = {
  rowIndex: 0,
  payload: {
    internal_sku: 'SKU-1',
    raw_barcode: null,
    raw_trade_name: 'Аспирин',
    raw_dosage_form: null,
    raw_dosage_strength: null,
    raw_manufacturer_name: null,
    price_diram: '1500',
    quantity: 10,
    expires_at: '2030-12-31',
    batch_number: null,
  },
}

describe('ProcessInventorySyncBatchService (DTJ-441)', () => {
  it('загружает raw items по batchId, реконструирует IngestRowInput и вызывает ТОТ ЖЕ use case (execute)', async () => {
    const repository = new FakeInventorySyncBatchRepository()
    repository.seed(makeQueuedBatch(), [RAW_ITEM])
    const execute = vi.fn<(cmd: unknown) => Promise<IngestInventoryBatchResult>>().mockResolvedValue({
      batchId: BATCH_ID,
      status: 'completed_full_success',
      acceptedRows: 1,
      rejectedRows: 0,
    })
    const ingestBatch = { execute } as unknown as IngestInventoryBatchWithMatchingUseCase
    const service = new ProcessInventorySyncBatchService(repository, ingestBatch)

    const result = await service.process(BATCH_ID)

    expect(result).toEqual({ batchId: BATCH_ID, status: 'completed_full_success', acceptedRows: 1, rejectedRows: 0 })
    expect(execute).toHaveBeenCalledTimes(1)
    const command = execute.mock.calls[0]?.[0] as { readonly rows: readonly IngestRowInput[] }
    expect(command.rows).toEqual([
      {
        rowIndex: 0,
        internalSku: 'SKU-1',
        rawBarcode: null,
        rawTradeName: 'Аспирин',
        rawDosageForm: null,
        rawDosageStrength: null,
        rawManufacturerName: null,
        priceDiram: 1500n,
        quantity: 10,
        expiresAtIso: '2030-12-31',
        batchNumber: null,
        resolved: false,
        resolvedMedicineId: null,
      },
    ])
  })

  it('батч уже в терминальном статусе (повторная доставка job) — возвращает снимок, use case НЕ вызывается', async () => {
    const repository = new FakeInventorySyncBatchRepository()
    const batch = makeQueuedBatch()
    batch.markProcessing()
    batch.markCompletedFullSuccess()
    repository.seed(batch, [RAW_ITEM])
    const execute = vi.fn()
    const ingestBatch = { execute } as unknown as IngestInventoryBatchWithMatchingUseCase
    const service = new ProcessInventorySyncBatchService(repository, ingestBatch)

    const result = await service.process(BATCH_ID)

    expect(result.status).toBe('completed_full_success')
    expect(execute).not.toHaveBeenCalled()
  })

  it('batchId не найден — бросает ошибку (BullMQ ретраит/failed-handler залогирует)', async () => {
    const repository = new FakeInventorySyncBatchRepository()
    const ingestBatch = { execute: vi.fn() } as unknown as IngestInventoryBatchWithMatchingUseCase
    const service = new ProcessInventorySyncBatchService(repository, ingestBatch)

    await expect(service.process('unknown-batch-id')).rejects.toThrow()
  })
})
