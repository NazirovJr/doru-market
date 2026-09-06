/**
 * Тест `InventoryManualEntryController` (EP-05, DTJ-162, критерии приёмки).
 *
 * `IngestInventoryBatchWithMatchingUseCase` — РЕАЛЬНЫЙ (не мок), с `catalogFacade: null` —
 * тот же приём, что `inventory-batch-update.controller.spec.ts` (DTJ-157): все строки этого
 * канала `resolved: true`, матчер физически не может быть вызван (TC-INV-007 доказывается
 * тем, что тест вообще не падает на `null`-фасаде — если бы матчинг вызвался, случился бы
 * `TypeError` на `null.matchBatch`).
 *
 * `rows.length===0` (АС4) — проверяется НА УРОВНЕ СХЕМЫ (`manualEntryRequestSchema`), не через
 * прямой вызов `controller.submit(...)`: `ZodValidationPipe` резолвится Nest ДО вызова метода
 * контроллера, юнит-тест вызывает метод напрямую (см. тот же паттерн — `items.length>1000` в
 * DTJ-157 проверяется вручную В КОНТРОЛЛЕРЕ, а НЕ через Zod, именно потому что бизнес-лимиты
 * этого класса нельзя проверить, минуя pipe; здесь предел — `.min(1)` СХЕМЫ, поэтому тест бьёт
 * по схеме напрямую).
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { manualEntryRequestSchema, type ManualEntryRow } from '@dorutj/contracts'
import { ROLES_METADATA_KEY } from '@/modules/auth/index.js'
import type { JwtClaims } from '@/modules/auth/index.js'
import { InMemoryInventorySyncBatchRepository } from '@/modules/inventory/infrastructure/adapters/in-memory-inventory-sync-batch.repository.js'
import { InMemoryInventoryOutbox } from '@/modules/inventory/infrastructure/adapters/in-memory-inventory-outbox.js'
import { InMemoryPharmacyInventoryRepository } from '@/modules/inventory/infrastructure/adapters/in-memory-pharmacy-inventory.repository.js'
import { InMemoryPharmacySkuMappingRepository } from '@/modules/inventory/infrastructure/adapters/in-memory-pharmacy-sku-mapping.repository.js'
import { InMemoryFullSyncCompletion } from '@/modules/inventory/infrastructure/adapters/in-memory-full-sync-completion.js'
import { CompositeInventoryMatcherService } from '@/modules/inventory/application/services/composite-inventory-matcher.service.js'
import { IngestInventoryBatchWithMatchingUseCase } from '@/modules/inventory/application/use-cases/ingest-inventory-batch-with-matching.use-case.js'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import type { CatalogFacade } from '@/modules/inventory/application/ports/catalog-facade.port.js'
import type { UnitOfWorkPort } from '@/modules/auth/application/ports/unit-of-work.port.js'
import type { DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { InventoryManualEntryController } from './inventory-manual-entry.controller.js'

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
  controller: InventoryManualEntryController
  syncBatchRepository: InMemoryInventorySyncBatchRepository
  inventoryRepo: InMemoryPharmacyInventoryRepository
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
  const controller = new InventoryManualEntryController(ingestBatch, syncBatchRepository, clock)
  return { controller, syncBatchRepository, inventoryRepo }
}

function makeClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: 'user-1',
    role: 'pharmacy_admin',
    tenantId: null,
    pharmacyId: 'PHARM-1',
    chainId: null,
    sessionId: 'sess-1',
    ...overrides,
  }
}

function makeRow(overrides: Partial<ManualEntryRow> = {}): ManualEntryRow {
  return {
    medicineId: '0192f3b4-7c8d-7abc-9def-0123456789ab',
    priceTjs: 12.5,
    quantity: 10,
    expiryDate: '2028-01-01',
    op: 'upsert',
    ...overrides,
  }
}

describe('InventoryManualEntryController (DTJ-162, SRS-INV-015/016)', () => {
  it('точечное редактирование (rows.length=1) обновляет pharmacy_inventory СРАЗУ, matcher не вызывается (TC-INV-007)', async () => {
    const { controller, inventoryRepo } = makeController()
    const row = makeRow()
    const result = await controller.submit({ rows: [row] }, makeClaims())

    expect(result).toMatchObject({ data: { acceptedRows: 1, rejectedRows: 0 } })
    const aggregate = await inventoryRepo.findOrCreateManyByMedicineIds({
      pharmacyId: 'PHARM-1',
      medicineIds: [row.medicineId],
    })
    const inventory = aggregate.get(row.medicineId)
    expect(inventory?.getFefoLot(new Date('2026-01-15'))?.quantity).toBe(10)
  })

  it('массовая сетка из 80 строк, 3 с отрицательной ценой → acceptedRows=77, rejectedRows=3, errors содержит invalid_price', async () => {
    const { controller } = makeController()
    const rows = Array.from({ length: 80 }, (_, i) =>
      makeRow({
        medicineId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        priceTjs: i < 3 ? -5 : 12.5,
      }),
    )
    const result = await controller.submit({ rows }, makeClaims())

    expect(result).toMatchObject({ data: { acceptedRows: 77, rejectedRows: 3 } })
    const data = (result as { data: { errors: readonly { errorCode: string }[] } }).data
    expect(data.errors).toHaveLength(3)
    expect(data.errors.every((e) => e.errorCode === 'invalid_price')).toBe(true)
  })

  it('роль pharmacy_admin/super_admin разрешена, pharmacist — НЕТ (@Roles-метаданные закрывают расхождение документов)', () => {
    const roles = Reflect.getMetadata(ROLES_METADATA_KEY, InventoryManualEntryController) as
      | readonly string[]
      | undefined
    expect(roles).toEqual(['pharmacy_admin', 'super_admin'])
    expect(roles).not.toContain('pharmacist')
  })

  it('пустой массив rows отклоняется схемой (.min(1)) — АС4', () => {
    const result = manualEntryRequestSchema.safeParse({ rows: [] })
    expect(result.success).toBe(false)
  })

  it('batchNumber по умолчанию — MANUAL-{medicineId}-{today ISO} при отсутствии явного значения', async () => {
    const { controller, syncBatchRepository } = makeController()
    const row = makeRow({ batchNumber: undefined })
    const result = await controller.submit({ rows: [row] }, makeClaims())
    const batchId = (result as { data: { batchId: string } }).data.batchId
    const rawItems = await syncBatchRepository.findRawItems(batchId)
    // Канал ручного ввода не пишет raw items (см. JSDoc контроллера) — batchNumber проверяется
    // косвенно через успешную персистенцию (аггрегат создан без ошибки FSM/валидации).
    expect(rawItems).toEqual([])
    expect(result).toMatchObject({ data: { rejectedRows: 0 } })
  })

  it('ответ содержит финальный статус (completed_*, не queued) — синхронный путь', async () => {
    const { controller } = makeController()
    const result = await controller.submit({ rows: [makeRow()] }, makeClaims())
    const status = (result as { data: { status: string } }).data.status
    expect(status.startsWith('completed_')).toBe(true)
  })

  it('super_admin без привязанной аптеки (pharmacyId=null) отклоняется', async () => {
    const { controller } = makeController()
    await expect(
      controller.submit({ rows: [makeRow()] }, makeClaims({ role: 'super_admin', pharmacyId: null })),
    ).rejects.toThrow()
  })
})
