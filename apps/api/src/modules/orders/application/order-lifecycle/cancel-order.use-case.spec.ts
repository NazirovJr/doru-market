/**
 * `CancelOrderUseCase` (EP-09, DTJ-232) — матрица «статус × payment_method × актор» из
 * SRS-ORD-029 (таблица `21-module-orders-payments-escrow.md` §9), плюс тенант-скоуп
 * (SRS-API-043/046), идемпотентность возврата остатка (D-EP09-30) и ноль вызовов рефанда для
 * наличных (D-EP09-29, зеркало проверки `createInvoice` из DTJ-230).
 *
 * `OrdersFacade` — РЕАЛЬНЫЙ инстанс поверх `InMemoryOrderRepository` (та же фикстура, что
 * `orders.facade.spec.ts`), не мок: проверяем реальную мутацию статуса/сохранение, не только
 * факт вызова. `InventoryFacadePort`/`RefundFacadePort` — inline `vi.fn()`-моки (тот же стиль,
 * что `availability-calculator.service.spec.ts` для `InventoryFacadePort`).
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { err, isOk, ok } from '@dorutj/domain-kernel'
import { ErrorCode, ForbiddenError, NotFoundError, PaymentProviderUnavailableError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import type { InventoryFacadePort, ReleaseStockItemCommand } from '@/modules/orders/application/ports/inventory-facade.port.js'
import type { RefundError, RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import { CancelOrderUseCase } from './cancel-order.use-case.js'
import type { CancelOrderActor } from './dto/cancel-order-command.dto.js'

const NOW = new Date('2026-09-02T12:00:00.000Z')

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

const SILENT_LOGGER = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger

/** Тот же приём, что `order.entity.spec.ts` — `restore()` для прямой установки статуса в тесте. */
function orderAtStatus(status: OrderSnapshot['status'], overrides: Partial<OrderSnapshot> = {}): Order {
  const paymentMethod = status === 'confirmed' ? 'cash_courier' : overrides.paymentMethod ?? 'alif_mobi'
  const created = Order.create(validOrderCreateCommand({ paymentMethod }))
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({ ...created.value.toSnapshot(), status, ...overrides })
}

const CUSTOMER: CancelOrderActor = { userId: 'customer-1', role: 'customer', tenantId: 'tenant-1', pharmacyId: null }
const PHARMACIST_OWN: CancelOrderActor = {
  userId: 'pharmacist-1',
  role: 'pharmacist',
  tenantId: 'tenant-1',
  pharmacyId: 'pharmacy-1',
}
const PHARMACIST_OTHER: CancelOrderActor = {
  userId: 'pharmacist-2',
  role: 'pharmacist',
  tenantId: 'tenant-1',
  pharmacyId: 'pharmacy-2',
}

interface Harness {
  readonly useCase: CancelOrderUseCase
  readonly repo: InMemoryOrderRepository
  readonly inventoryFacade: InventoryFacadePort
  readonly refundFacade: RefundFacadePort
  readonly releaseStock: ReturnType<typeof vi.fn>
  readonly refundFull: ReturnType<typeof vi.fn>
}

function makeHarness(): Harness {
  const repo = new InMemoryOrderRepository()
  const ordersFacade = new OrdersFacade(repo)
  const releaseStock = vi.fn<InventoryFacadePort['releaseStock']>().mockResolvedValue(undefined)
  const inventoryFacade: InventoryFacadePort = {
    reserveStock: vi.fn(),
    releaseStock,
    hasExpiredReservedBatch: vi.fn(),
    getStockQuantity: vi.fn(),
    reserveForOrder: vi.fn(),
    reconcileZeroStock: vi.fn(),
  }
  const refundFull = vi.fn<RefundFacadePort['refundFull']>().mockResolvedValue(ok(undefined))
  const refundFacade: RefundFacadePort = { refundFull }
  const useCase = new CancelOrderUseCase(ordersFacade, inventoryFacade, refundFacade, new FixedClock(), SILENT_LOGGER)
  return { useCase, repo, inventoryFacade, refundFacade, releaseStock, refundFull }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CancelOrderUseCase — матрица SRS-ORD-029 (статус × payment_method)', () => {
  it('AC1: confirmed (cash_courier), customer → cancelled, refundFull НЕ вызван, releaseStock вызван', async () => {
    const { useCase, repo, refundFull, releaseStock } = makeHarness()
    const order = orderAtStatus('confirmed')
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, actor: CUSTOMER, reason: 'customer_changed_mind' })

    expect(result).toEqual({ orderId: order.id, status: 'cancelled', refundIssued: false })
    expect(refundFull).not.toHaveBeenCalled()
    expect(releaseStock).toHaveBeenCalledTimes(1)
    const saved = await repo.findById(CUSTOMER.tenantId, order.id)
    expect(saved?.status).toBe('cancelled')
  })

  it('pending_payment (non-cash), customer → cancelled, без рефанда (деньги ещё не платились)', async () => {
    const { useCase, repo, refundFull, releaseStock } = makeHarness()
    const order = orderAtStatus('pending_payment')
    repo.seed(order)

    await useCase.execute({ orderId: order.id, actor: CUSTOMER, reason: 'customer_changed_mind' })

    expect(refundFull).not.toHaveBeenCalled()
    expect(releaseStock).toHaveBeenCalledTimes(1)
  })

  it('confirmed (cash), pharmacist своей аптеки, без согласования super_admin (SRS-ORD-031) → без рефанда', async () => {
    const { useCase, repo, refundFull, releaseStock } = makeHarness()
    const order = orderAtStatus('confirmed')
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACIST_OWN, reason: 'pharmacy_suspended' })

    expect(result.refundIssued).toBe(false)
    expect(refundFull).not.toHaveBeenCalled()
    expect(releaseStock).toHaveBeenCalledTimes(1)
  })

  it('AC2: paid_escrow (non-cash), pharmacist своей аптеки → cancelled, refundFull вызван РОВНО один раз', async () => {
    const { useCase, repo, refundFull, releaseStock } = makeHarness()
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACIST_OWN, reason: 'pharmacy_suspended' })

    expect(result).toEqual({ orderId: order.id, status: 'cancelled', refundIssued: true })
    expect(refundFull).toHaveBeenCalledTimes(1)
    expect(refundFull).toHaveBeenCalledWith(order.id, 'pharmacy_suspended')
    expect(releaseStock).toHaveBeenCalledTimes(1)
  })

  it('paid_escrow (non-cash), customer → refundFull вызван один раз', async () => {
    const { useCase, repo, refundFull } = makeHarness()
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    await useCase.execute({ orderId: order.id, actor: CUSTOMER, reason: 'found_cheaper_elsewhere' })

    expect(refundFull).toHaveBeenCalledTimes(1)
  })

  it('processing, достигнут из confirmed (cash) → без рефанда (та же логика, что confirmed)', async () => {
    const { useCase, repo, refundFull, releaseStock } = makeHarness()
    const order = orderAtStatus('processing', { paymentMethod: 'cash_courier' })
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACIST_OWN, reason: 'pickup_sla_timeout' })

    expect(result.refundIssued).toBe(false)
    expect(refundFull).not.toHaveBeenCalled()
    expect(releaseStock).toHaveBeenCalledTimes(1)
  })

  it('processing, достигнут из paid_escrow (non-cash) → refundFull вызван', async () => {
    const { useCase, repo, refundFull, releaseStock } = makeHarness()
    const order = orderAtStatus('processing', { paymentMethod: 'alif_mobi' })
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, actor: CUSTOMER, reason: 'customer_changed_mind' })

    expect(result.refundIssued).toBe(true)
    expect(refundFull).toHaveBeenCalledTimes(1)
    expect(releaseStock).toHaveBeenCalledTimes(1)
  })
})

describe('CancelOrderUseCase — авторизация (OrderPolicy, SRS-DOM-154/SRS-ORD-031)', () => {
  it('AC3: picked_up → 403 Forbidden, статус не меняется, refundFull/releaseStock НЕ вызваны', async () => {
    const { useCase, repo, refundFull, releaseStock } = makeHarness()
    const order = orderAtStatus('picked_up')
    repo.seed(order)

    await expect(useCase.execute({ orderId: order.id, actor: CUSTOMER, reason: 'customer_changed_mind' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )

    expect(refundFull).not.toHaveBeenCalled()
    expect(releaseStock).not.toHaveBeenCalled()
    const saved = await repo.findById(CUSTOMER.tenantId, order.id)
    expect(saved?.status).toBe('picked_up')
  })

  it('AC4: pharmacist НЕ своей аптеки → 403 Forbidden, releaseStock/refundFull НЕ вызваны', async () => {
    const { useCase, repo, refundFull, releaseStock } = makeHarness()
    const order = orderAtStatus('paid_escrow', { pharmacyId: 'pharmacy-1' })
    repo.seed(order)

    await expect(
      useCase.execute({ orderId: order.id, actor: PHARMACIST_OTHER, reason: 'pharmacy_suspended' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(refundFull).not.toHaveBeenCalled()
    expect(releaseStock).not.toHaveBeenCalled()
  })

  it('чужой тенант → 404 NotFoundError (SRS-API-046, НЕ 403 — существование не подтверждается)', async () => {
    const { useCase, repo } = makeHarness()
    const order = orderAtStatus('paid_escrow', { tenantId: 'tenant-1' })
    repo.seed(order)
    const otherTenantActor: CancelOrderActor = { ...CUSTOMER, tenantId: 'tenant-2' }

    await expect(
      useCase.execute({ orderId: order.id, actor: otherTenantActor, reason: 'customer_changed_mind' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('несуществующий заказ → 404 NotFoundError', async () => {
    const { useCase } = makeHarness()

    await expect(
      useCase.execute({ orderId: randomUUID(), actor: CUSTOMER, reason: 'customer_changed_mind' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('CancelOrderUseCase — идемпотентность возврата остатка (D-EP09-30)', () => {
  it('двойная отмена: второй вызов — 403 (cancelled не входит в CANCELLABLE_STATUSES), releaseStock/refundFull — по одному разу СУММАРНО', async () => {
    const { useCase, repo, refundFull, releaseStock } = makeHarness()
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    await useCase.execute({ orderId: order.id, actor: CUSTOMER, reason: 'customer_changed_mind' })
    await expect(
      useCase.execute({ orderId: order.id, actor: CUSTOMER, reason: 'customer_changed_mind' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(releaseStock).toHaveBeenCalledTimes(1)
    expect(refundFull).toHaveBeenCalledTimes(1)
  })
})

describe('CancelOrderUseCase — событие OrderCancelledEvent (refundIssued)', () => {
  it('refundIssued=true для non-cash в paid_escrow, залогировано с этим значением', async () => {
    const { useCase, repo } = makeHarness()
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    await useCase.execute({ orderId: order.id, actor: CUSTOMER, reason: 'customer_changed_mind' })

    expect(SILENT_LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: order.id, reason: 'customer_changed_mind', refundIssued: true }),
      'order_cancelled',
    )
  })

  it('refundIssued=false для cash в confirmed, залогировано с этим значением', async () => {
    const { useCase, repo } = makeHarness()
    const order = orderAtStatus('confirmed')
    repo.seed(order)

    await useCase.execute({ orderId: order.id, actor: CUSTOMER, reason: 'customer_changed_mind' })

    expect(SILENT_LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: order.id, refundIssued: false }),
      'order_cancelled',
    )
  })
})

describe('CancelOrderUseCase — отказ RefundFacadePort', () => {
  it('refundFull возвращает err → PaymentProviderUnavailableError, releaseStock уже был вызван (склад не остаётся заблокирован)', async () => {
    const repo = new InMemoryOrderRepository()
    const ordersFacade = new OrdersFacade(repo)
    const releaseStock = vi.fn<InventoryFacadePort['releaseStock']>().mockResolvedValue(undefined)
    const inventoryFacade: InventoryFacadePort = {
      reserveStock: vi.fn(),
      releaseStock,
      hasExpiredReservedBatch: vi.fn(),
      getStockQuantity: vi.fn(),
      reserveForOrder: vi.fn(),
      reconcileZeroStock: vi.fn(),
    }
    const refundError: RefundError = { code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, message: 'bank down' }
    const refundFull = vi.fn<RefundFacadePort['refundFull']>().mockResolvedValue(err(refundError))
    const refundFacade: RefundFacadePort = { refundFull }
    const useCase = new CancelOrderUseCase(ordersFacade, inventoryFacade, refundFacade, new FixedClock(), SILENT_LOGGER)
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    await expect(useCase.execute({ orderId: order.id, actor: CUSTOMER, reason: 'customer_changed_mind' })).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    )

    expect(releaseStock).toHaveBeenCalledTimes(1)
    const saved = await repo.findById(CUSTOMER.tenantId, order.id)
    expect(saved?.status).toBe('cancelled') // отмена уже сохранена — рефанд не откатывает её (D-EP09-17, тот же принцип)
  })
})

describe('CancelOrderUseCase — releaseStock построен из order.items', () => {
  it('releaseStock вызывается с (inventoryBatchId, quantity) каждой позиции заказа', async () => {
    const { useCase, repo, releaseStock } = makeHarness()
    const order = orderAtStatus('confirmed')
    repo.seed(order)
    const expected: readonly ReleaseStockItemCommand[] = order.items.map((item) => ({
      inventoryBatchId: item.inventoryBatchId,
      quantity: item.quantity,
    }))

    await useCase.execute({ orderId: order.id, actor: CUSTOMER, reason: 'customer_changed_mind' })

    expect(releaseStock).toHaveBeenCalledWith(expected)
  })
})
