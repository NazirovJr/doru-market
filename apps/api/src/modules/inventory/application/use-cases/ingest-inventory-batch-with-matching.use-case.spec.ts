/**
 * Тест `IngestInventoryBatchWithMatchingUseCase` (EP-05, DTJ-148, SRS-INV-001/010/056).
 *
 * Проверяет ключевые сценарии из тест-плана тикета:
 *   1. Все строки валидны и резолвлены → `completed_full_success`.
 *   2. Часть строк `unmatched` → `completed_partial_success` с правильными счётчиками.
 *   3. Невалидная цена одной строки не блокирует остальные.
 *   4. Попытка `execute()` на батче в терминальном статусе бросает
 *      `IllegalBatchStatusTransitionError`.
 *   5. `unitOfWork.run(...)` вызывается ровно один раз (волна 6, после
 *      исправления self-deadlock пула — ТОЛЬКО персистентная фаза, ШАГИ 2-6;
 *      матчинг, ШАГ 1, теперь ВНЕ транзакции, см. JSDoc use case'а
 *      «Границы unitOfWork.run» — заголовок теста намеренно НЕ говорит «вся
 *      обработка», это больше не так).
 *
 * Локальные Map-based фейки портов (не production `InMemory*`-адаптеры из
 * infrastructure: application не импортирует infrastructure, §1.1).
 */
import { describe, expect, it } from 'vitest'
import { CompositeInventoryMatcherService } from '../services/composite-inventory-matcher.service.js'
import {
  IngestInventoryBatchWithMatchingUseCase,
  type IngestRowInput,
} from './ingest-inventory-batch-with-matching.use-case.js'
import { type FullSyncCompletionPort, type ZeroOutMissingInput } from '../ports/full-sync-completion.port.js'
import { type UnitOfWorkPort, type UnitOfWorkTx } from '@/modules/auth/application/ports/unit-of-work.port.js'
import { type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { InventorySyncBatch } from '@/modules/inventory/domain/inventory-sync-batch.entity.js'
import { IllegalBatchStatusTransitionError } from '@/modules/inventory/domain/errors/inventory.errors.js'
import type {
  CreateInventorySyncBatchInput,
  IncompleteFullSyncSession,
  InventorySyncBatchRepository,
  InventorySyncRowError,
  RawInventoryRow,
} from '../ports/inventory-sync-batch.repository.port.js'
import type { InventorySyncStatus } from '@/modules/inventory/domain/inventory-sync.types.js'
import type {
  FullSyncSessionStuckEvent,
  InventoryBatchQueuedEvent,
  InventoryOutboxPort,
  UnmatchedInventoryRowEvent,
} from '../ports/inventory-outbox.port.js'
import type {
  PharmacyInventoryRepository,
  UpsertResult,
} from '../ports/pharmacy-inventory.repository.port.js'
import type { InventoryBatchUpsertRow } from '@/modules/inventory/domain/value-objects/inventory-batch-upsert-row.vo.js'
import { PharmacyInventory } from '@/modules/inventory/domain/pharmacy-inventory.entity.js'
import type {
  PharmacySkuMappingEntry,
  PharmacySkuMappingRepository,
} from '../ports/pharmacy-sku-mapping.repository.port.js'

class FakePharmacyInventoryRepository implements PharmacyInventoryRepository {
  private readonly rows = new Map<string, InventoryBatchUpsertRow>()
  private readonly aggregates = new Map<string, PharmacyInventory>()

  private makeKey(pharmacyId: string, row: InventoryBatchUpsertRow): string {
    return `${pharmacyId}|${row.getMedicineId()}|${row.getBatchNumber() ?? ''}|${row.getExpiresAt()}`
  }

  upsertMany(input: {
    pharmacyId: string
    rows: readonly InventoryBatchUpsertRow[]
  }): Promise<UpsertResult> {
    let accepted = 0
    let updated = 0
    for (const row of input.rows) {
      const key = this.makeKey(input.pharmacyId, row)
      if (this.rows.has(key)) {
        updated += 1
      } else {
        accepted += 1
      }
      this.rows.set(key, row)
    }
    return Promise.resolve({ acceptedCount: accepted, updatedCount: updated })
  }

  findOrCreateManyByMedicineIds(input: {
    pharmacyId: string
    medicineIds: readonly string[]
  }): Promise<ReadonlyMap<string, PharmacyInventory>> {
    const result = new Map<string, PharmacyInventory>()
    for (const medicineId of input.medicineIds) {
      const key = `${input.pharmacyId}::${medicineId}`
      let aggregate = this.aggregates.get(key)
      if (aggregate === undefined) {
        const created = PharmacyInventory.create({ id: key, pharmacyId: input.pharmacyId, medicineId })
        if (!created.ok) {
          throw new Error(`failed to create PharmacyInventory: ${created.error.message}`)
        }
        this.aggregates.set(key, created.value)
        aggregate = created.value
      }
      result.set(medicineId, aggregate)
    }
    return Promise.resolve(result)
  }

  saveMany(aggregates: readonly PharmacyInventory[]): Promise<void> {
    for (const aggregate of aggregates) {
      this.aggregates.set(`${aggregate.pharmacyId}::${aggregate.medicineId}`, aggregate)
    }
    return Promise.resolve()
  }
}

class FakeInventorySyncBatchRepository implements InventorySyncBatchRepository {
  private readonly batches = new Map<string, InventorySyncBatch>()
  private readonly errors: InventorySyncRowError[] = []

  create(_input: CreateInventorySyncBatchInput): Promise<{ readonly id: string }> {
    throw new Error('not used in ingest tests')
  }

  markStatus(_id: string, _status: InventorySyncStatus): Promise<void> {
    throw new Error('not used in ingest tests')
  }

  findById(id: string): Promise<InventorySyncBatch | null> {
    return Promise.resolve(this.batches.get(id) ?? null)
  }

  save(batch: InventorySyncBatch): Promise<void> {
    this.batches.set(batch.id, batch)
    return Promise.resolve()
  }

  appendErrors(errors: readonly InventorySyncRowError[]): Promise<void> {
    this.errors.push(...errors)
    return Promise.resolve()
  }

  findRawItems(_batchId: string): Promise<readonly RawInventoryRow[]> {
    throw new Error('not used in ingest tests')
  }

  createIfNotExists(_input: {
    readonly id: string
    readonly pharmacyId: string
    readonly channel: 'rest' | 'excel' | 'manual'
    readonly syncType: 'delta' | 'full'
    readonly fullSyncSessionId: string | null
    readonly isLastPage: boolean
    readonly totalRows: number
    readonly note: string | null
    readonly now: Date
  }): Promise<{ readonly batch: InventorySyncBatch; readonly created: boolean }> {
    throw new Error('not used in ingest tests')
  }

  appendRawItems(
    _batchId: string,
    _items: readonly { readonly rowIndex: number; readonly payload: Readonly<Record<string, unknown>> }[],
  ): Promise<void> {
    throw new Error('not used in ingest tests')
  }

  findIncompleteFullSyncSessions(
    _olderThanMinutes: number,
  ): Promise<readonly IncompleteFullSyncSession[]> {
    throw new Error('not used in ingest tests')
  }

  findPharmacyChainId(_pharmacyId: string): Promise<string | null> {
    throw new Error('not used in ingest tests')
  }

  findManyForReport(_input: {
    readonly pharmacyId: string | null
    readonly chainId: string | null
    readonly cursor: { readonly v: string; readonly id: string } | null
    readonly limit: number
  }): ReturnType<InventorySyncBatchRepository['findManyForReport']> {
    throw new Error('not used in ingest tests')
  }

  findRowErrorsByBatchId(_batchId: string): ReturnType<InventorySyncBatchRepository['findRowErrorsByBatchId']> {
    throw new Error('not used in ingest tests')
  }

  findBySourceUploadId(_sourceUploadId: string): ReturnType<InventorySyncBatchRepository['findBySourceUploadId']> {
    throw new Error('not used in ingest tests')
  }

  /** TEST-ONLY: прочитать все накопленные ошибки. */
  getAllErrors(): readonly InventorySyncRowError[] {
    return this.errors
  }
}

class FakePharmacySkuMappingRepository implements PharmacySkuMappingRepository {
  private readonly store = new Map<string, PharmacySkuMappingEntry>()

  private static compositeKey(pharmacyId: string, internalSku: string): string {
    return `${pharmacyId}::${internalSku}`
  }

  findManyByPharmacyAndSkus(
    pharmacyId: string,
    skus: readonly string[],
  ): Promise<ReadonlyMap<string, PharmacySkuMappingEntry>> {
    const result = new Map<string, PharmacySkuMappingEntry>()
    for (const sku of skus) {
      const entry = this.store.get(FakePharmacySkuMappingRepository.compositeKey(pharmacyId, sku))
      if (entry !== undefined) {
        result.set(sku, entry)
      }
    }
    return Promise.resolve(result)
  }

  upsert(input: {
    pharmacyId: string
    internalSku: string
    medicineId: string
    matchedVia: 'barcode' | 'name_fuzzy' | 'manual_resolve'
  }): Promise<void> {
    const key = FakePharmacySkuMappingRepository.compositeKey(input.pharmacyId, input.internalSku)
    this.store.set(key, { medicineId: input.medicineId, matchedVia: input.matchedVia })
    return Promise.resolve()
  }
}

class FakeInventoryOutbox implements InventoryOutboxPort {
  public readonly events: UnmatchedInventoryRowEvent[] = []
  public readonly stuckEvents: FullSyncSessionStuckEvent[] = []
  public readonly batchQueuedEvents: InventoryBatchQueuedEvent[] = []

  append(event: UnmatchedInventoryRowEvent): void {
    this.events.push(event)
  }

  appendStuckSession(event: FullSyncSessionStuckEvent): void {
    this.stuckEvents.push(event)
  }

  appendBatchQueued(event: InventoryBatchQueuedEvent): void {
    this.batchQueuedEvents.push(event)
  }

  hasStuckAlert(_fullSyncSessionId: string, _withinMinutes: number): Promise<boolean> {
    return Promise.resolve(false)
  }
}

const PHARMACY_ID = '22222222-2222-2222-2222-222222222222'
const MEDICINE_1 = '11111111-1111-1111-1111-111111111111'
const BATCH_ID = '44444444-4444-4444-4444-444444444444'
const VALID_GLOBAL_BARCODE = '4601234567893'

class FixedClock implements Clock {
   
  now(): Date {
    return new Date('2026-01-15T10:00:00.000Z')
  }
}

class NoopUnitOfWork implements UnitOfWorkPort {
  async run<T>(callback: Parameters<UnitOfWorkPort['run']>[0]): Promise<T> {
     
    return (callback as (tx: UnitOfWorkTx) => Promise<T>)(null)
  }
}

class NoopFullSyncCompletion implements FullSyncCompletionPort {
  public zeroOutCalls = 0
  zeroOutMissing(_input: ZeroOutMissingInput): Promise<{ readonly zeroedLots: number }> {
    this.zeroOutCalls += 1
    return Promise.resolve({ zeroedLots: 0 })
  }
}

function makeValidResolvedRow(rowIndex: number, internalSku: string, medicineId: string): IngestRowInput {
  return {
    rowIndex,
    internalSku,
    rawBarcode: VALID_GLOBAL_BARCODE,
    rawTradeName: 'Аспирин',
    rawDosageForm: 'tablets',
    rawDosageStrength: '500 мг',
    rawManufacturerName: 'Acme',
    priceDiram: 15000n,
    quantity: 10,
    expiresAtIso: '2030-12-31',
    batchNumber: `LOT-${String(rowIndex)}`,
    resolved: true,
    resolvedMedicineId: medicineId,
  }
}

function makeUnresolvedRow(rowIndex: number, internalSku: string): IngestRowInput {
  return {
    rowIndex,
    internalSku,
    rawBarcode: null,
    rawTradeName: 'Цитрамон П',
    rawDosageForm: 'tablets',
    rawDosageStrength: '500 мг',
    rawManufacturerName: 'Unknown',
    priceDiram: 5000n,
    quantity: 5,
    expiresAtIso: '2030-12-31',
    batchNumber: null,
    resolved: false,
    resolvedMedicineId: null,
  }
}

interface UseCaseHarness {
  useCase: IngestInventoryBatchWithMatchingUseCase
  syncBatchRepository: FakeInventorySyncBatchRepository
  fullSyncCompletion: NoopFullSyncCompletion
}

function makeHarness(): UseCaseHarness {
  const inventoryRepository = new FakePharmacyInventoryRepository()
  const syncBatchRepository = new FakeInventorySyncBatchRepository()
  const skuMappingRepository = new FakePharmacySkuMappingRepository()
  const outbox = new FakeInventoryOutbox()
  const matcher = new CompositeInventoryMatcherService(skuMappingRepository, null, outbox)
  const fullSyncCompletion = new NoopFullSyncCompletion()
  const useCase = new IngestInventoryBatchWithMatchingUseCase(
    inventoryRepository,
    syncBatchRepository,
    matcher,
    fullSyncCompletion,
    new FixedClock(),
    new NoopUnitOfWork(),
  )
  return { useCase, syncBatchRepository, fullSyncCompletion }
}

async function seedQueuedBatch(
  syncBatchRepository: FakeInventorySyncBatchRepository,
  totalRows: number,
): Promise<void> {
  const batch = InventorySyncBatch.create(
    {
      id: BATCH_ID,
      pharmacyId: PHARMACY_ID,
      channel: 'manual',
      syncType: 'delta',
      totalRows,
    },
    new Date('2026-01-15T10:00:00.000Z'),
  )
  await syncBatchRepository.save(batch)
}

describe('IngestInventoryBatchWithMatchingUseCase (DTJ-148)', () => {
  it('все строки валидны и сматчены → completed_full_success', async () => {
    const { useCase, syncBatchRepository } = makeHarness()
    await seedQueuedBatch(syncBatchRepository, 2)
    const rows = [
      makeValidResolvedRow(0, 'SKU-1', MEDICINE_1),
      makeValidResolvedRow(1, 'SKU-2', MEDICINE_1),
    ]
    const result = await useCase.execute({
      batchId: BATCH_ID,
      pharmacyId: PHARMACY_ID,
      syncType: 'delta',
      fullSyncSessionId: null,
      isLastPage: true,
      rows,
    })
    expect(result.status).toBe('completed_full_success')
    expect(result.acceptedRows).toBe(2)
    expect(result.rejectedRows).toBe(0)
  })

  it('невалидная цена одной строки не блокирует остальные строки батча', async () => {
    const { useCase, syncBatchRepository } = makeHarness()
    await seedQueuedBatch(syncBatchRepository, 3)
    const rows = [
      makeValidResolvedRow(0, 'SKU-1', MEDICINE_1),
      { ...makeValidResolvedRow(1, 'SKU-2', MEDICINE_1), priceDiram: -1n },
      makeValidResolvedRow(2, 'SKU-3', MEDICINE_1),
    ]
    const result = await useCase.execute({
      batchId: BATCH_ID,
      pharmacyId: PHARMACY_ID,
      syncType: 'delta',
      fullSyncSessionId: null,
      isLastPage: true,
      rows,
    })
    expect(result.status).toBe('completed_partial_success')
    expect(result.acceptedRows).toBe(2)
    expect(result.rejectedRows).toBe(1)
    const errors = syncBatchRepository.getAllErrors()
    expect(errors.length).toBe(1)
    expect(errors[0]?.errorCode).toBe('invalid_price')
    expect(errors[0]?.rowIndex).toBe(1)
  })

  it('unmatched-строка формирует inventory_sync_errors', async () => {
    const { useCase, syncBatchRepository } = makeHarness()
    await seedQueuedBatch(syncBatchRepository, 1)
    const rows = [makeUnresolvedRow(0, 'SKU-UNK')]
    const result = await useCase.execute({
      batchId: BATCH_ID,
      pharmacyId: PHARMACY_ID,
      syncType: 'delta',
      fullSyncSessionId: null,
      isLastPage: true,
      rows,
    })
    expect(result.status).toBe('completed_partial_success')
    expect(result.rejectedRows).toBe(1)
    const errors = syncBatchRepository.getAllErrors()
    expect(errors[0]?.errorCode).toBe('unmatched_medicine')
  })

  it('syncType=delta НЕ вызывает FullSyncCompletion даже при isLastPage=true', async () => {
    const { useCase, syncBatchRepository, fullSyncCompletion } = makeHarness()
    await seedQueuedBatch(syncBatchRepository, 1)
    await useCase.execute({
      batchId: BATCH_ID,
      pharmacyId: PHARMACY_ID,
      syncType: 'delta',
      fullSyncSessionId: null,
      isLastPage: true,
      rows: [makeValidResolvedRow(0, 'SKU-1', MEDICINE_1)],
    })
    expect(fullSyncCompletion.zeroOutCalls).toBe(0)
  })

  it('syncType=full + isLastPage=true ВЫЗЫВАЕТ FullSyncCompletion.zeroOutMissing', async () => {
    const { useCase, syncBatchRepository, fullSyncCompletion } = makeHarness()
    const sessionId = 'session-1'
    const batch = InventorySyncBatch.create(
      {
        id: BATCH_ID,
        pharmacyId: PHARMACY_ID,
        channel: 'rest',
        syncType: 'full',
        totalRows: 1,
        fullSyncSessionId: sessionId,
        isLastPage: true,
      },
      new Date('2026-01-15T10:00:00.000Z'),
    )
    await syncBatchRepository.save(batch)
    await useCase.execute({
      batchId: BATCH_ID,
      pharmacyId: PHARMACY_ID,
      syncType: 'full',
      fullSyncSessionId: sessionId,
      isLastPage: true,
      rows: [makeValidResolvedRow(0, 'SKU-1', MEDICINE_1)],
    })
    expect(fullSyncCompletion.zeroOutCalls).toBe(1)
  })

  it('попытка execute() на батче в терминальном статусе бросает IllegalBatchStatusTransitionError', async () => {
    const { useCase, syncBatchRepository } = makeHarness()
    const snapshotBatch = InventorySyncBatch.create(
      {
        id: BATCH_ID,
        pharmacyId: PHARMACY_ID,
        channel: 'manual',
        syncType: 'delta',
        totalRows: 1,
      },
      new Date('2026-01-15T10:00:00.000Z'),
    )
    snapshotBatch.markProcessing()
    snapshotBatch.markCompletedFullSuccess()
    await syncBatchRepository.save(snapshotBatch)
    await expect(
      useCase.execute({
        batchId: BATCH_ID,
        pharmacyId: PHARMACY_ID,
        syncType: 'delta',
        fullSyncSessionId: null,
        isLastPage: true,
        rows: [makeValidResolvedRow(0, 'SKU-1', MEDICINE_1)],
      }),
    ).rejects.toBeInstanceOf(IllegalBatchStatusTransitionError)
  })

  it('персистентная фаза (шаги 2-6) выполняется в одной unitOfWork.run(...); матчинг (шаг 1) — вне неё', async () => {
    let calls = 0
    class CountingUnitOfWork implements UnitOfWorkPort {
      async run<T>(callback: Parameters<UnitOfWorkPort['run']>[0]): Promise<T> {
        calls += 1
         
        return (callback as (tx: UnitOfWorkTx) => Promise<T>)(null)
      }
    }
    const inventoryRepository = new FakePharmacyInventoryRepository()
    const syncBatchRepository = new FakeInventorySyncBatchRepository()
    const skuMappingRepository = new FakePharmacySkuMappingRepository()
    const outbox = new FakeInventoryOutbox()
    const matcher = new CompositeInventoryMatcherService(skuMappingRepository, null, outbox)
    const useCase = new IngestInventoryBatchWithMatchingUseCase(
      inventoryRepository,
      syncBatchRepository,
      matcher,
      new NoopFullSyncCompletion(),
      new FixedClock(),
      new CountingUnitOfWork(),
    )
    await seedQueuedBatch(syncBatchRepository, 1)
    await useCase.execute({
      batchId: BATCH_ID,
      pharmacyId: PHARMACY_ID,
      syncType: 'delta',
      fullSyncSessionId: null,
      isLastPage: true,
      rows: [makeValidResolvedRow(0, 'SKU-1', MEDICINE_1)],
    })
    expect(calls).toBe(1)
  })
})
