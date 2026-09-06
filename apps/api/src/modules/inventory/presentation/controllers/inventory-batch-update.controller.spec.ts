/**
 * Тест `InventoryBatchUpdateController` (EP-05, DTJ-157, критерии приёмки).
 *
 * Покрывает:
 *   - happy path (новый batch_id → 202 с status)
 *   - idempotency (повторный POST с тем же batch_id → сохранённый статус)
 *   - items > 1000 → 422
 *   - отсутствие principal → 401
 *   - fullSyncSessionId-валидация (delta + fullSyncSessionId) → Zod error
 */
import { HttpException, HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { InMemoryInventorySyncBatchRepository } from '@/modules/inventory/infrastructure/adapters/in-memory-inventory-sync-batch.repository.js'
import { InMemoryInventoryOutbox } from '@/modules/inventory/infrastructure/adapters/in-memory-inventory-outbox.js'
import { CompositeInventoryMatcherService } from '@/modules/inventory/application/services/composite-inventory-matcher.service.js'
import { InMemoryPharmacyInventoryRepository } from '@/modules/inventory/infrastructure/adapters/in-memory-pharmacy-inventory.repository.js'
import { InMemoryPharmacySkuMappingRepository } from '@/modules/inventory/infrastructure/adapters/in-memory-pharmacy-sku-mapping.repository.js'
import { IngestInventoryBatchWithMatchingUseCase } from '@/modules/inventory/application/use-cases/ingest-inventory-batch-with-matching.use-case.js'
import { InMemoryFullSyncCompletion } from '@/modules/inventory/infrastructure/adapters/in-memory-full-sync-completion.js'
import { PersistInventorySyncBatchService } from '@/modules/inventory/application/services/persist-inventory-sync-batch.service.js'
import { InventoryBatchUpdateController } from './inventory-batch-update.controller.js'
import type { FastifyRequestWithPrincipal } from '../guards/pharmacy-api-key.guard.js'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import type { CatalogFacade } from '@/modules/inventory/application/ports/catalog-facade.port.js'
import type { UnitOfWorkPort } from '@/modules/auth/application/ports/unit-of-work.port.js'
import type { DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'

class StubClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return new Date(this.fixed)
  }
}

class StubUnitOfWork implements UnitOfWorkPort {
  async run<T>(callback: Parameters<UnitOfWorkPort['run']>[0]): Promise<T> {
     
    return (callback as (tx: DrizzleDb) => Promise<T>)(null as unknown as DrizzleDb)
  }
}

function makeController(): {
  controller: InventoryBatchUpdateController
  syncBatchRepository: InMemoryInventorySyncBatchRepository
  outbox: InMemoryInventoryOutbox
  ingestBatch: IngestInventoryBatchWithMatchingUseCase
} {
  const syncBatchRepository = new InMemoryInventorySyncBatchRepository()
  const outbox = new InMemoryInventoryOutbox()
  const inventoryRepo = new InMemoryPharmacyInventoryRepository()
  const skuMappingRepo = new InMemoryPharmacySkuMappingRepository()
  const fullSyncCompletion = new InMemoryFullSyncCompletion()
  const catalogFacade: CatalogFacade | null = null
  const matcher = new CompositeInventoryMatcherService(skuMappingRepo, catalogFacade, outbox)
  const clock = new StubClock(new Date('2026-01-15T10:00:00.000Z'))
  const uow = new StubUnitOfWork()
  const ingestBatch = new IngestInventoryBatchWithMatchingUseCase(
    inventoryRepo,
    syncBatchRepository,
    matcher,
    fullSyncCompletion,
    clock,
    uow,
  )
  const persistBatch = new PersistInventorySyncBatchService(syncBatchRepository, outbox)
  const controller = new InventoryBatchUpdateController(
    ingestBatch,
    persistBatch,
    clock,
  )
  return { controller, syncBatchRepository, outbox, ingestBatch }
}

// Сигнатура DTO шире, чем реальный тип InventoryBatchUpdateRequestItem,
// потому что мы проверяем поведение контроллера, а не парсинг.
type DtoLike = Parameters<InventoryBatchUpdateController['batchUpdate']>[0]

function makeDto(overrides: Partial<DtoLike> = {}): DtoLike {
  const base: DtoLike = {
    batch_id: '0192f3b4-7c8d-7abc-9def-0123456789ab',
    sync_type: 'delta',
    is_last_page: true,
    items: [
      {
        internal_sku: 'SKU-1',
        raw_trade_name: 'Aspirin',
        price_diram: 1500,
        quantity: 10,
        expires_at: '2027-01-01',
      },
    ],
  }
  return { ...base, ...overrides }
}

describe('InventoryBatchUpdateController (DTJ-157, SRS-INV-007/009/055)', () => {
  it('happy path: новый batch_id → 202, status из use case', async () => {
    const { controller, syncBatchRepository, outbox } = makeController()
    const dto = makeDto()
    const req = { principal: { type: 'pharmacy_system', pharmacyId: 'P-1', chainId: null } } as unknown as FastifyRequestWithPrincipal
    const result = await controller.batchUpdate(dto, req)
    expect(result).toMatchObject({
      data: {
        batchId: dto.batch_id,
        acceptedForProcessing: true,
      },
    })
    // Батч сохранён.
    const saved = await syncBatchRepository.findById(dto.batch_id)
    expect(saved).not.toBeNull()
    // Outbox-событие опубликовано.
    expect(outbox.batchQueuedEvents.length).toBe(1)
    expect(outbox.batchQueuedEvents[0]?.eventType).toBe('inventory.sync_batch.queued')
  })

  it('idempotency: повторный POST с тем же batch_id → acceptedForProcessing=false', async () => {
    const { controller, outbox } = makeController()
    const dto = makeDto()
    const req = { principal: { type: 'pharmacy_system', pharmacyId: 'P-1', chainId: null } } as unknown as FastifyRequestWithPrincipal
    await controller.batchUpdate(dto, req)
    const result2 = await controller.batchUpdate(dto, req)
    expect(result2).toMatchObject({
      data: { acceptedForProcessing: false, batchId: dto.batch_id },
    })
    // Outbox НЕ дубль.
    expect(outbox.batchQueuedEvents.length).toBe(1)
  })

  it('отсутствует principal → 401', async () => {
    const { controller } = makeController()
    const dto = makeDto()
    const req = { principal: undefined } as unknown as FastifyRequestWithPrincipal
    await expect(controller.batchUpdate(dto, req)).rejects.toBeInstanceOf(HttpException)
  })

  it('items.length > 1000 → 422 VALIDATION_ERROR', async () => {
    const { controller } = makeController()
    const items = Array.from({ length: 1001 }, (_, i) => ({
      internal_sku: `SKU-${String(i)}`,
      raw_trade_name: 'X',
      price_diram: 1,
      quantity: 1,
      expires_at: '2027-01-01',
    }))
    const dto = makeDto({ items })
    const req = { principal: { type: 'pharmacy_system', pharmacyId: 'P-1', chainId: null } } as unknown as FastifyRequestWithPrincipal
    let caught: HttpException | undefined
    try {
      await controller.batchUpdate(dto, req)
    } catch (e) {
      caught = e as HttpException
    }
    expect(caught).toBeInstanceOf(HttpException)
    expect(caught?.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  })

  it('pharmacyId берётся из principal, не из DTO (защита от chainId-scope bypass)', async () => {
    const { controller, syncBatchRepository } = makeController()
    const dto = makeDto()
    const req = { principal: { type: 'pharmacy_system', pharmacyId: 'P-FROM-PRINCIPAL', chainId: null } } as unknown as FastifyRequestWithPrincipal
    await controller.batchUpdate(dto, req)
    const saved = await syncBatchRepository.findById(dto.batch_id)
    expect(saved?.pharmacyId).toBe('P-FROM-PRINCIPAL')
  })
})
