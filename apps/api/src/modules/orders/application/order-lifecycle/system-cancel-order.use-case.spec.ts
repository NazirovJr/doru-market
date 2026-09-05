/**
 * `SystemCancelOrderUseCase` (EP-10, DTJ-253/254) — тот же стиль дублёров, что
 * `cancel-order.use-case.spec.ts` (EP-09, DTJ-232): `OrdersFacade` реальный поверх
 * `InMemoryOrderRepository` (проверяем реальную мутацию, не только факт вызова),
 * `InventoryFacadePort`/`RefundFacadePort` — inline `vi.fn()`-моки.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { err, isOk, ok } from '@dorutj/domain-kernel'
import { ErrorCode, NotFoundError, PaymentProviderUnavailableError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import type { InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import type { RefundError, RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import { SystemCancelOrderUseCase, type SystemCancelOrderCommand } from './system-cancel-order.use-case.js'

const NOW = new Date('2026-09-04T03:00:00.000Z')
const TENANT_ID = 'tenant-1'

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

/** Тот же приём, что `cancel-order.use-case.spec.ts` — `restore()` для прямой установки статуса. */
function orderAtStatus(status: OrderSnapshot['status'], overrides: Partial<OrderSnapshot> = {}): Order {
  const paymentMethod = status === 'confirmed' ? 'cash_courier' : (overrides.paymentMethod ?? 'alif_mobi')
  const created = Order.create(validOrderCreateCommand({ paymentMethod, tenantId: TENANT_ID }))
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({ ...created.value.toSnapshot(), status, ...overrides })
}

interface Harness {
  readonly useCase: SystemCancelOrderUseCase
  readonly repo: InMemoryOrderRepository
  readonly releaseStock: ReturnType<typeof vi.fn<InventoryFacadePort['releaseStock']>>
  readonly refundFull: ReturnType<typeof vi.fn<RefundFacadePort['refundFull']>>
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
  const useCase = new SystemCancelOrderUseCase(ordersFacade, inventoryFacade, refundFacade, new FixedClock(), SILENT_LOGGER)
  return { useCase, repo, releaseStock, refundFull }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SystemCancelOrderUseCase (DTJ-253/254)', () => {
  it('non-cash pending_payment (DTJ-253) — отменяет, освобождает остаток, рефанд НЕ вызывается (ещё нечего возвращать)', async () => {
    const { useCase, repo, releaseStock, refundFull } = makeHarness()
    const order = orderAtStatus('pending_payment')
    await repo.save(order)

    const cmd: SystemCancelOrderCommand = {
      tenantId: TENANT_ID,
      orderId: order.id,
      expectedFromStatus: 'pending_payment',
      reason: 'payment_timeout',
    }
    const result = await useCase.execute(cmd)

    expect(result).toEqual({ orderId: order.id, status: 'cancelled', refundIssued: false })
    const saved = await repo.findById(TENANT_ID, order.id)
    expect(saved?.status).toBe('cancelled')
    expect(releaseStock).toHaveBeenCalledTimes(1)
    expect(refundFull).not.toHaveBeenCalled()
  })

  it('non-cash paid_escrow (DTJ-254) — отменяет, освобождает остаток, рефанд ВЫЗЫВАЕТСЯ ровно один раз', async () => {
    const { useCase, repo, releaseStock, refundFull } = makeHarness()
    const order = orderAtStatus('paid_escrow')
    await repo.save(order)

    const result = await useCase.execute({
      tenantId: TENANT_ID,
      orderId: order.id,
      expectedFromStatus: 'paid_escrow',
      reason: 'pickup_sla_timeout',
    })

    expect(result).toEqual({ orderId: order.id, status: 'cancelled', refundIssued: true })
    expect(releaseStock).toHaveBeenCalledTimes(1)
    expect(refundFull).toHaveBeenCalledExactlyOnceWith(order.id, 'pickup_sla_timeout')
  })

  it('cash confirmed (DTJ-254 cash-ветка) — отменяет, освобождает остаток, рефанд НЕ вызывается ни разу (D-25)', async () => {
    const { useCase, repo, releaseStock, refundFull } = makeHarness()
    const order = orderAtStatus('confirmed')
    await repo.save(order)

    const result = await useCase.execute({
      tenantId: TENANT_ID,
      orderId: order.id,
      expectedFromStatus: 'confirmed',
      reason: 'pickup_sla_timeout',
    })

    expect(result).toEqual({ orderId: order.id, status: 'cancelled', refundIssued: false })
    expect(releaseStock).toHaveBeenCalledTimes(1)
    expect(refundFull).not.toHaveBeenCalled()
  })

  it('гонка: реальный статус заказа РАСХОДИТСЯ с expectedFromStatus (заказ успел оплатиться между сканом джобы и этим вызовом) — пропускает, НЕ отменяет только что оплаченный заказ', async () => {
    const { useCase, repo, releaseStock, refundFull } = makeHarness()
    const order = orderAtStatus('paid_escrow') // джоба видела pending_payment, но к вызову заказ УЖЕ paid_escrow
    await repo.save(order)

    const result = await useCase.execute({
      tenantId: TENANT_ID,
      orderId: order.id,
      expectedFromStatus: 'pending_payment',
      reason: 'payment_timeout',
    })

    expect(result).toEqual({ orderId: order.id, status: 'skipped', refundIssued: false })
    const saved = await repo.findById(TENANT_ID, order.id)
    expect(saved?.status).toBe('paid_escrow') // НЕ тронут
    expect(releaseStock).not.toHaveBeenCalled()
    expect(refundFull).not.toHaveBeenCalled()
  })

  it('заказ уже cancelled (двойной прогон джобы/ретрай) — пропускает идемпотентно, НЕ бросает InvalidOrderStatusTransitionError', async () => {
    const { useCase, repo, releaseStock } = makeHarness()
    const order = orderAtStatus('cancelled')
    await repo.save(order)

    const result = await useCase.execute({
      tenantId: TENANT_ID,
      orderId: order.id,
      expectedFromStatus: 'pending_payment',
      reason: 'payment_timeout',
    })

    expect(result.status).toBe('skipped')
    expect(releaseStock).not.toHaveBeenCalled()
  })

  it('заказ не найден (чужой тенант или несуществующий id) — бросает NotFoundError', async () => {
    const { useCase } = makeHarness()
    await expect(
      useCase.execute({ tenantId: TENANT_ID, orderId: 'missing-order', expectedFromStatus: 'pending_payment', reason: 'payment_timeout' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('RefundFacadePort возвращает Err → пробрасывает PaymentProviderUnavailableError, но отмена/release уже применены (не откатываются)', async () => {
    const { repo, releaseStock } = makeHarness()
    const order = orderAtStatus('paid_escrow')
    await repo.save(order)
    const refundError: RefundError = { code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, message: 'bank down' }
    const refundFacade: RefundFacadePort = { refundFull: vi.fn().mockResolvedValue(err(refundError)) }
    const inventoryFacade: InventoryFacadePort = {
      reserveStock: vi.fn(),
      releaseStock,
      hasExpiredReservedBatch: vi.fn(),
      getStockQuantity: vi.fn(),
      reserveForOrder: vi.fn(),
      reconcileZeroStock: vi.fn(),
    }
    const failingUseCase = new SystemCancelOrderUseCase(
      new OrdersFacade(repo),
      inventoryFacade,
      refundFacade,
      new FixedClock(),
      SILENT_LOGGER,
    )

    await expect(
      failingUseCase.execute({ tenantId: TENANT_ID, orderId: order.id, expectedFromStatus: 'paid_escrow', reason: 'pickup_sla_timeout' }),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError)
    const saved = await repo.findById(TENANT_ID, order.id)
    expect(saved?.status).toBe('cancelled') // отмена уже совершилась до вызова рефанда
    expect(releaseStock).toHaveBeenCalledTimes(1)
  })

  it('releaseStock получает inventoryBatchId/quantity позиций заказа (не пустой массив)', async () => {
    const { useCase, repo, releaseStock } = makeHarness()
    const order = orderAtStatus('pending_payment')
    await repo.save(order)

    await useCase.execute({ tenantId: TENANT_ID, orderId: order.id, expectedFromStatus: 'pending_payment', reason: 'payment_timeout' })

    const releasedItems = releaseStock.mock.calls[0]![0]
    expect(releasedItems.length).toBeGreaterThan(0)
    expect(releasedItems[0]).toEqual({
      inventoryBatchId: order.items[0]?.inventoryBatchId,
      quantity: order.items[0]?.quantity,
    })
  })
})
