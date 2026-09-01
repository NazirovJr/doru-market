/**
 * Тест `IngestInventoryBatchWithMatchingUseCase` (EP-05, DTJ-148, SRS-INV-001/010/056).
 *
 * Проверяет ключевые сценарии из тест-плана тикета:
 *   1. Все строки валидны и резолвлены → `completed_full_success`.
 *   2. Часть строк `unmatched` → `completed_partial_success` с правильными счётчиками.
 *   3. Невалидная цена одной строки не блокирует остальные.
 *   4. Попытка `execute()` на батче в терминальном статусе бросает
 *      `IllegalBatchStatusTransitionError`.
 *   5. Полный `unitOfWork.run(...)` обёртка — ровно один вызов.
 *
 * Использует InMemory-реализации портов, без реальной БД.
 */
import { describe, expect, it } from 'vitest'
import { InMemoryPharmacyInventoryRepository } from '../../infrastructure/adapters/in-memory-pharmacy-inventory.repository.js'
import { InMemoryInventorySyncBatchRepository } from '../../infrastructure/adapters/in-memory-inventory-sync-batch.repository.js'
import { InMemoryPharmacySkuMappingRepository } from '../../infrastructure/adapters/in-memory-pharmacy-sku-mapping.repository.js'
import { InMemoryInventoryOutbox } from '../../infrastructure/adapters/in-memory-inventory-outbox.js'
import { CompositeInventoryMatcherService } from '../services/composite-inventory-matcher.service.js'
import {
  IngestInventoryBatchWithMatchingUseCase,
  type IngestRowInput,
} from './ingest-inventory-batch-with-matching.use-case.js'
import { type FullSyncCompletionPort } from '../ports/full-sync-completion.port.js'
import { type UnitOfWorkPort } from '@/modules/auth/application/ports/unit-of-work.port.js'
import { type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { InventorySyncBatch } from '../../domain/inventory-sync-batch.entity.js'
import { IllegalBatchStatusTransitionError } from '../../domain/errors/inventory.errors.js'

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
     
    return (callback as (tx: DrizzleDb) => Promise<T>)(null as unknown as DrizzleDb)
  }
}

class NoopFullSyncCompletion implements FullSyncCompletionPort {
  public zeroOutCalls = 0
  async zeroOutMissing(
    _pharmacyId: string,
    _sessionId: string,
    _timestamp: Date,
  ): Promise<{ readonly zeroedLots: number }> {
    this.zeroOutCalls += 1
    return { zeroedLots: 0 }
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
  syncBatchRepository: InMemoryInventorySyncBatchRepository
  fullSyncCompletion: NoopFullSyncCompletion
}

function makeHarness(): UseCaseHarness {
  const inventoryRepository = new InMemoryPharmacyInventoryRepository()
  const syncBatchRepository = new InMemoryInventorySyncBatchRepository()
  const skuMappingRepository = new InMemoryPharmacySkuMappingRepository()
  const outbox = new InMemoryInventoryOutbox()
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
  syncBatchRepository: InMemoryInventorySyncBatchRepository,
): Promise<void> {
  const batch = InventorySyncBatch.create(
    {
      id: BATCH_ID,
      pharmacyId: PHARMACY_ID,
      channel: 'manual',
      syncType: 'delta',
      totalRows: 5,
    },
    new Date('2026-01-15T10:00:00.000Z'),
  )
  await syncBatchRepository.save(batch)
}

describe('IngestInventoryBatchWithMatchingUseCase (DTJ-148)', () => {
  it('все строки валидны и сматчены → completed_full_success', async () => {
    const { useCase, syncBatchRepository } = makeHarness()
    await seedQueuedBatch(syncBatchRepository)
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
    await seedQueuedBatch(syncBatchRepository)
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
    await seedQueuedBatch(syncBatchRepository)
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
    await seedQueuedBatch(syncBatchRepository)
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

  it('вся обработка батча выполняется в одной unitOfWork.run(...)', async () => {
    let calls = 0
    class CountingUnitOfWork implements UnitOfWorkPort {
      async run<T>(callback: Parameters<UnitOfWorkPort['run']>[0]): Promise<T> {
        calls += 1
         
        return (callback as (tx: DrizzleDb) => Promise<T>)(null as unknown as DrizzleDb)
      }
    }
    const inventoryRepository = new InMemoryPharmacyInventoryRepository()
    const syncBatchRepository = new InMemoryInventorySyncBatchRepository()
    const skuMappingRepository = new InMemoryPharmacySkuMappingRepository()
    const outbox = new InMemoryInventoryOutbox()
    const matcher = new CompositeInventoryMatcherService(skuMappingRepository, null, outbox)
    const useCase = new IngestInventoryBatchWithMatchingUseCase(
      inventoryRepository,
      syncBatchRepository,
      matcher,
      new NoopFullSyncCompletion(),
      new FixedClock(),
      new CountingUnitOfWork(),
    )
    await seedQueuedBatch(syncBatchRepository)
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
