/**
 * `ScanOrderItemUseCase` (DTJ-302, EP-12 §A.3, SRS-PHT-011..016) — пайплайн валидации, каждая
 * ветвь (а-е) отдельным кейсом, включая `internal_sku`-путь (TC-PHT-028). `CatalogFacadePort`/
 * `InventoryFacadePort`/`ClockPort` — замоканы (ticket «Тест-план»), `OrderRepositoryPort` —
 * реальный `InMemoryOrderRepository` (тот же приём, что `cancel-order.use-case.spec.ts`: реальная
 * мутация проверяется, не только факт вызова).
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isOk, ok, err } from '@dorutj/domain-kernel'
import {
  BatchNotAvailableForSubstitutionError,
  ErrorCode,
  ExpiredStockError,
  ForbiddenError,
  ItemAlreadyScannedError,
  ItemNotInOrderError,
  NotFoundError,
} from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand, validOrderItemCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { FakeCatalogFacadePort } from '@/modules/orders/testing/fixtures/fake-catalog-facade-port.fixture.js'
import type { OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import { ScanOrderItemUseCase, type ScanOrderItemActor, type ScanOrderItemCommand } from './scan-order-item.use-case.js'

const NOW = new Date('2026-09-04T12:00:00.000Z')

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

const PASSTHROUGH_UOW: OrdersUnitOfWorkPort = { run: (callback) => callback(undefined) }

const MEDICINE_ID = randomUUID()
const ORIGINAL_BATCH_ID = randomUUID()
const PHARMACY_ID = 'pharmacy-1'
const TENANT_ID = 'tenant-1'
const RAW_BARCODE = '4601964000125'

const PHARMACIST_OWN: ScanOrderItemActor = { userId: 'pharmacist-1', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }
const PHARMACIST_OTHER: ScanOrderItemActor = { userId: 'pharmacist-2', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: 'pharmacy-2' }
const PHARMACY_ADMIN: ScanOrderItemActor = { userId: 'admin-1', role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }

function makeOrder(overrides: Partial<OrderSnapshot> = {}): Order {
  const created = Order.create(
    validOrderCreateCommand({
      tenantId: TENANT_ID,
      pharmacyId: PHARMACY_ID,
      items: [validOrderItemCommand({ medicineId: MEDICINE_ID, inventoryBatchId: ORIGINAL_BATCH_ID, pharmacyId: PHARMACY_ID })],
    }),
  )
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Object.keys(overrides).length === 0 ? created.value : Order.restore({ ...created.value.toSnapshot(), ...overrides })
}

/** Позиция уже `scanned_ok`/`unavailable` — для проверки пайплайн-шага «г» (SRS-PHT-013). */
function makeOrderWithItemStatus(status: OrderSnapshot['items'][number]['fulfillmentStatus']): Order {
  const base = makeOrder()
  const snapshot = base.toSnapshot()
  return Order.restore({
    ...snapshot,
    items: snapshot.items.map((item) => ({ ...item, fulfillmentStatus: status })),
  })
}

interface Harness {
  readonly useCase: ScanOrderItemUseCase
  readonly repo: InMemoryOrderRepository
  readonly catalogFacade: FakeCatalogFacadePort
  readonly inventoryFacade: InventoryFacadePort
  readonly reserveForOrder: ReturnType<typeof vi.fn>
  readonly releaseStock: ReturnType<typeof vi.fn>
}

function makeHarness(): Harness {
  const repo = new InMemoryOrderRepository()
  const catalogFacade = new FakeCatalogFacadePort()
  const reserveForOrder = vi.fn<InventoryFacadePort['reserveForOrder']>()
  const releaseStock = vi.fn<InventoryFacadePort['releaseStock']>().mockResolvedValue(undefined)
  const inventoryFacade: InventoryFacadePort = {
    reserveStock: vi.fn(),
    releaseStock,
    hasExpiredReservedBatch: vi.fn(),
    getStockQuantity: vi.fn(),
    reserveForOrder,
  }
  const useCase = new ScanOrderItemUseCase(repo, PASSTHROUGH_UOW, catalogFacade, inventoryFacade, new FixedClock())
  return { useCase, repo, catalogFacade, inventoryFacade, reserveForOrder, releaseStock }
}

function baseCommand(order: Order, overrides: Partial<ScanOrderItemCommand> = {}): ScanOrderItemCommand {
  const item = order.items[0]
  if (!item) throw new Error('fixture: expected item')
  return {
    orderId: order.id,
    itemId: item.id,
    rawBarcode: RAW_BARCODE,
    manualEntry: false,
    scannedBatchNumber: null,
    actor: PHARMACIST_OWN,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ScanOrderItemUseCase — пайплайн-шаги а-в (SRS-PHT-011/012)', () => {
  it('штрихкод резолвится в верный medicineId, без scannedBatchNumber → 200, scanned_ok, scanMethod=camera', async () => {
    const { useCase, catalogFacade, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)
    catalogFacade.setBarcodeResolution(PHARMACY_ID, RAW_BARCODE, MEDICINE_ID)

    const dto = await useCase.execute(baseCommand(order))

    expect(dto.fulfillmentStatus).toBe('scanned_ok')
    expect(dto.scannedBatchId).toBe(ORIGINAL_BATCH_ID)
    expect(dto.scanMethod).toBe('camera')
    expect(dto.scannedBy).toBe(PHARMACIST_OWN.userId)
    expect(dto.scannedAt).toBe(NOW.toISOString())
  })

  it('manualEntry=true → scan_method=manual (SRS-PHT-016, тот же пайплайн)', async () => {
    const { useCase, catalogFacade, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)
    catalogFacade.setBarcodeResolution(PHARMACY_ID, RAW_BARCODE, MEDICINE_ID)

    const dto = await useCase.execute(baseCommand(order, { manualEntry: true }))

    expect(dto.scanMethod).toBe('manual')
  })

  it('TC-PHT-028: невалидный EAN-13 (internal_sku), но резолвится в верный medicineId → успех', async () => {
    const { useCase, catalogFacade, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)
    const internalSku = 'SKU-00921' // не 13 цифр — не EAN-13, трактуется как internal_sku (D-06)
    catalogFacade.setBarcodeResolution(PHARMACY_ID, internalSku, MEDICINE_ID)

    const dto = await useCase.execute(baseCommand(order, { rawBarcode: internalSku, manualEntry: true }))

    expect(dto.fulfillmentStatus).toBe('scanned_ok')
    expect(dto.scanMethod).toBe('manual')
  })

  it('SRS-PHT-012: штрихкод резолвится в ДРУГОЙ медикамент → 404 ItemNotInOrderError, позиция остаётся pending', async () => {
    const { useCase, catalogFacade, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)
    catalogFacade.setBarcodeResolution(PHARMACY_ID, RAW_BARCODE, randomUUID()) // другой медикамент

    await expect(useCase.execute(baseCommand(order))).rejects.toBeInstanceOf(ItemNotInOrderError)

    const saved = await repo.findById(TENANT_ID, order.id)
    expect(saved?.items[0]?.fulfillmentStatus).toBe('pending')
  })

  it('штрихкод НИКУДА не резолвится (null) → 404 ItemNotInOrderError (тот же код, что «другой медикамент»)', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)
    // Ни один setBarcodeResolution не зарегистрирован — FakeCatalogFacadePort вернёт null.

    await expect(useCase.execute(baseCommand(order))).rejects.toBeInstanceOf(ItemNotInOrderError)
  })
})

describe('ScanOrderItemUseCase — пайплайн-шаг г (SRS-PHT-013)', () => {
  it('позиция уже scanned_ok → 409 ItemAlreadyScannedError, InventoryFacade НЕ вызывается', async () => {
    const { useCase, catalogFacade, reserveForOrder, releaseStock, repo } = makeHarness()
    const order = makeOrderWithItemStatus('scanned_ok')
    repo.seed(order)
    catalogFacade.setBarcodeResolution(PHARMACY_ID, RAW_BARCODE, MEDICINE_ID)

    await expect(useCase.execute(baseCommand(order))).rejects.toBeInstanceOf(ItemAlreadyScannedError)

    expect(reserveForOrder).not.toHaveBeenCalled()
    expect(releaseStock).not.toHaveBeenCalled()
  })

  it('позиция уже unavailable → 409 ItemAlreadyScannedError (не «использованная» попытка иначе)', async () => {
    const { useCase, catalogFacade, repo } = makeHarness()
    const order = makeOrderWithItemStatus('unavailable')
    repo.seed(order)
    catalogFacade.setBarcodeResolution(PHARMACY_ID, RAW_BARCODE, MEDICINE_ID)

    await expect(useCase.execute(baseCommand(order))).rejects.toBeInstanceOf(ItemAlreadyScannedError)
  })
})

describe('ScanOrderItemUseCase — пайплайн-шаг д, замена партии (SRS-PHT-014)', () => {
  it('TC-PHT-007: валидная партия того же товара/аптеки → 200, batchId обновлён, release(old)+reserve(new)', async () => {
    const { useCase, catalogFacade, reserveForOrder, releaseStock, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)
    const newBatchId = randomUUID()
    catalogFacade.setBarcodeResolution(PHARMACY_ID, RAW_BARCODE, MEDICINE_ID)
    reserveForOrder.mockResolvedValue(ok({ batchId: newBatchId }))

    const dto = await useCase.execute(baseCommand(order, { scannedBatchNumber: 'L2409A' }))

    expect(dto.scannedBatchId).toBe(newBatchId)
    expect(reserveForOrder).toHaveBeenCalledWith(PHARMACY_ID, MEDICINE_ID, 'L2409A', order.items[0]?.quantity, undefined)
    expect(releaseStock).toHaveBeenCalledWith([{ inventoryBatchId: ORIGINAL_BATCH_ID, quantity: order.items[0]?.quantity }], undefined)
    const saved = await repo.findById(TENANT_ID, order.id)
    expect(saved?.items[0]?.inventoryBatchId).toBe(newBatchId)
  })

  it('TC-PHT-006: партия просрочена → 422 EXPIRED_STOCK, releaseStock(старая) НЕ вызван (атомарность)', async () => {
    const { useCase, catalogFacade, reserveForOrder, releaseStock, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)
    catalogFacade.setBarcodeResolution(PHARMACY_ID, RAW_BARCODE, MEDICINE_ID)
    reserveForOrder.mockResolvedValue(err({ code: ErrorCode.EXPIRED_STOCK }))

    await expect(useCase.execute(baseCommand(order, { scannedBatchNumber: 'L-EXPIRED' }))).rejects.toBeInstanceOf(ExpiredStockError)

    expect(releaseStock).not.toHaveBeenCalled()
    const saved = await repo.findById(TENANT_ID, order.id)
    expect(saved?.items[0]?.fulfillmentStatus).toBe('pending')
    expect(saved?.items[0]?.inventoryBatchId).toBe(ORIGINAL_BATCH_ID)
  })

  it('TC-PHT-029: партия того же товара, ДРУГОЙ аптеки → 422 BATCH_NOT_AVAILABLE', async () => {
    const { useCase, catalogFacade, reserveForOrder, releaseStock, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)
    catalogFacade.setBarcodeResolution(PHARMACY_ID, RAW_BARCODE, MEDICINE_ID)
    reserveForOrder.mockResolvedValue(err({ code: ErrorCode.BATCH_NOT_AVAILABLE }))

    await expect(
      useCase.execute(baseCommand(order, { scannedBatchNumber: 'L-OTHER-PHARMACY' })),
    ).rejects.toBeInstanceOf(BatchNotAvailableForSubstitutionError)

    expect(releaseStock).not.toHaveBeenCalled()
  })

  it('недостаточно quantity в новой партии → 422 BATCH_NOT_AVAILABLE', async () => {
    const { useCase, catalogFacade, reserveForOrder, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)
    catalogFacade.setBarcodeResolution(PHARMACY_ID, RAW_BARCODE, MEDICINE_ID)
    reserveForOrder.mockResolvedValue(err({ code: ErrorCode.BATCH_NOT_AVAILABLE }))

    await expect(
      useCase.execute(baseCommand(order, { scannedBatchNumber: 'L-TOO-SMALL' })),
    ).rejects.toBeInstanceOf(BatchNotAvailableForSubstitutionError)
  })

  it('scannedBatchNumber отсутствует → валидация партии пропущена, InventoryFacade НЕ вызывается, исходная партия используется', async () => {
    const { useCase, catalogFacade, reserveForOrder, releaseStock, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)
    catalogFacade.setBarcodeResolution(PHARMACY_ID, RAW_BARCODE, MEDICINE_ID)

    const dto = await useCase.execute(baseCommand(order, { scannedBatchNumber: null }))

    expect(reserveForOrder).not.toHaveBeenCalled()
    expect(releaseStock).not.toHaveBeenCalled()
    expect(dto.scannedBatchId).toBe(ORIGINAL_BATCH_ID)
  })
})

describe('ScanOrderItemUseCase — авторизация и существование (SRS-API-043/046)', () => {
  it('несуществующий заказ → 404 NotFoundError', async () => {
    const { useCase } = makeHarness()
    await expect(
      useCase.execute({
        orderId: randomUUID(),
        itemId: randomUUID(),
        rawBarcode: RAW_BARCODE,
        manualEntry: false,
        scannedBatchNumber: null,
        actor: PHARMACIST_OWN,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('чужой тенант → 404 NotFoundError (не 403 — существование не подтверждается)', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)

    await expect(useCase.execute(baseCommand(order, { actor: { ...PHARMACIST_OWN, tenantId: 'tenant-2' } }))).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('pharmacist ДРУГОЙ аптеки → 403 ForbiddenError', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)

    await expect(useCase.execute(baseCommand(order, { actor: PHARMACIST_OTHER }))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pharmacy_admin (своя аптека) → 403 ForbiddenError (DTJ-302: РОВНО pharmacist, не pharmacy_admin)', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)

    await expect(useCase.execute(baseCommand(order, { actor: PHARMACY_ADMIN }))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('неизвестный itemId → 404 NotFoundError', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)

    await expect(useCase.execute(baseCommand(order, { itemId: randomUUID() }))).rejects.toBeInstanceOf(NotFoundError)
  })
})
