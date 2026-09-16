/**
 * `ResolvePartialFulfillmentUseCase` (DTJ-304, EP-12 §A.4, SRS-PHT-021/022/023/023a,
 * TC-PHT-011/012/013) — три ветки (`confirmed=true` явно/по таймауту, `confirmed=false`),
 * идемпотентность CAS (гонка клиент/таймер) и `PAYMENT_PROVIDER_UNAVAILABLE`-ветка (п.5
 * тикета: статус НЕ откатывается, retry-задача создана). Порты замоканы/фейкнуты (тот же
 * приём, что `CancelOrderUseCase`/`AcceptOrderUseCase`) — реальный Postgres/BullMQ вне
 * периметра этого набора.
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { err, isOk, ok } from '@dorutj/domain-kernel'
import { ErrorCode, NotFoundError, PaymentProviderUnavailableError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { InMemoryPartialFulfillmentRequestRepository } from '@/modules/orders/testing/fixtures/in-memory-partial-fulfillment-request-repository.fixture.js'
import { validOrderCreateCommand, validOrderItemCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import type { OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import type { InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import type { RefundError, RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import type { PartialFulfillmentRequestRecord } from '@/modules/orders/application/ports/partial-fulfillment-request-repository.port.js'
import { ResolvePartialFulfillmentUseCase, type ResolvePartialFulfillmentCommand } from './resolve-partial-fulfillment.use-case.js'

const NOW = new Date('2026-09-16T13:00:00.000Z')
const TENANT_ID = 'tenant-1'
const PHARMACY_ID = 'pharmacy-1'
const REQUEST_ID = randomUUID()

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

class PassthroughUnitOfWork implements OrdersUnitOfWorkPort {
  async run<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    return callback(undefined)
  }
}

function makeOrder(paymentMethod: OrderSnapshot['paymentMethod'] = 'alif_mobi'): Order {
  const created = Order.create(
    validOrderCreateCommand({
      tenantId: TENANT_ID,
      pharmacyId: PHARMACY_ID,
      paymentMethod,
      items: [validOrderItemCommand({ pharmacyId: PHARMACY_ID }), validOrderItemCommand({ pharmacyId: PHARMACY_ID })],
    }),
  )
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  const snapshot = created.value.toSnapshot()
  return Order.restore({
    ...snapshot,
    status: 'processing',
    items: snapshot.items.map((item, idx) => ({
      ...item,
      fulfillmentStatus: idx === 0 ? 'scanned_ok' : 'unavailable',
      itemIssueReason: idx === 0 ? null : 'out_of_stock',
    })),
  })
}

function makeRequest(orderId: string, overrides: Partial<PartialFulfillmentRequestRecord> = {}): PartialFulfillmentRequestRecord {
  return {
    id: REQUEST_ID,
    orderId,
    proposedBy: 'pharmacist-1',
    itemsSnapshot: [{ orderItemId: 'item-2', medicineName: 'Panadol', quantity: 2, reason: 'out_of_stock' }],
    itemsTotalBeforeDiram: 40_000n,
    itemsTotalAfterDiram: 20_000n,
    refundAmountDiram: 20_000n,
    status: 'awaiting_customer',
    idempotencyKey: randomUUID(),
    requestedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 600_000),
    respondedAt: null,
    ...overrides,
  }
}

interface Harness {
  readonly useCase: ResolvePartialFulfillmentUseCase
  readonly orderRepo: InMemoryOrderRepository
  readonly requestRepo: InMemoryPartialFulfillmentRequestRepository
  readonly appendAll: ReturnType<typeof vi.fn<OrdersOutboxPort['appendAll']>>
  readonly releaseStock: ReturnType<typeof vi.fn<InventoryFacadePort['releaseStock']>>
  readonly refundFull: ReturnType<typeof vi.fn<RefundFacadePort['refundFull']>>
  readonly refundPartialFulfillment: ReturnType<typeof vi.fn<RefundFacadePort['refundPartialFulfillment']>>
}

function makeHarness(): Harness {
  const orderRepo = new InMemoryOrderRepository()
  const requestRepo = new InMemoryPartialFulfillmentRequestRepository()
  const appendAll = vi.fn<OrdersOutboxPort['appendAll']>().mockResolvedValue(undefined)
  const ordersOutbox: OrdersOutboxPort = { appendAll }
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
  const refundPartialFulfillment = vi.fn<RefundFacadePort['refundPartialFulfillment']>().mockResolvedValue(ok(undefined))
  const refundFacade: RefundFacadePort = { refundFull, refundPartialFulfillment }
  const useCase = new ResolvePartialFulfillmentUseCase(
    orderRepo,
    new PassthroughUnitOfWork(),
    ordersOutbox,
    inventoryFacade,
    refundFacade,
    requestRepo,
    new FixedClock(),
  )
  return { useCase, orderRepo, requestRepo, appendAll, releaseStock, refundFull, refundPartialFulfillment }
}

function cmd(overrides: Partial<ResolvePartialFulfillmentCommand> = {}): ResolvePartialFulfillmentCommand {
  return { requestId: REQUEST_ID, tenantId: TENANT_ID, confirmed: true, source: 'customer', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ResolvePartialFulfillmentUseCase — confirmed=true, source=customer (SRS-PHT-022, TC-PHT-011)', () => {
  it('status → confirmed, items_total уменьшен, refundPartialFulfillment вызван с refundAmountDiram запроса', async () => {
    const { useCase, orderRepo, requestRepo, refundPartialFulfillment } = makeHarness()
    const order = makeOrder()
    orderRepo.seed(order)
    requestRepo.seed(makeRequest(order.id))

    const result = await useCase.execute(cmd())

    expect(result.status).toBe('confirmed')
    const saved = await orderRepo.findById(TENANT_ID, order.id)
    expect(saved?.itemsTotal.diram).toBe(20_000n)
    expect(refundPartialFulfillment).toHaveBeenCalledExactlyOnceWith({ orderId: order.id, refundAmountDiram: 20_000n })
  })

  it('публикует PartialFulfillmentConfirmedEvent в outbox', async () => {
    const { useCase, orderRepo, requestRepo, appendAll } = makeHarness()
    const order = makeOrder()
    orderRepo.seed(order)
    requestRepo.seed(makeRequest(order.id))

    await useCase.execute(cmd())

    expect(appendAll).toHaveBeenCalledExactlyOnceWith(
      TENANT_ID,
      expect.arrayContaining([expect.objectContaining({ type: 'PartialFulfillmentConfirmedEvent', orderId: order.id, requestId: REQUEST_ID })]),
      undefined,
    )
  })

  it('несуществующий запрос → 404 NotFoundError', async () => {
    const { useCase } = makeHarness()
    await expect(useCase.execute(cmd({ requestId: randomUUID() }))).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('ResolvePartialFulfillmentUseCase — confirmed=true, source=timeout (SRS-PHT-023a, TC-PHT-013)', () => {
  it('status → auto_confirmed_timeout, эффект идентичен явному подтверждению', async () => {
    const { useCase, orderRepo, requestRepo, appendAll } = makeHarness()
    const order = makeOrder()
    orderRepo.seed(order)
    requestRepo.seed(makeRequest(order.id))

    const result = await useCase.execute(cmd({ source: 'timeout' }))

    expect(result.status).toBe('auto_confirmed_timeout')
    expect(appendAll).toHaveBeenCalledExactlyOnceWith(
      TENANT_ID,
      expect.arrayContaining([expect.objectContaining({ type: 'PartialFulfillmentAutoConfirmedEvent' })]),
      undefined,
    )
  })

  it('запрос уже confirmed (клиент опередил таймер) → идемпотентный no-op, эффект НЕ применяется повторно', async () => {
    const { useCase, orderRepo, requestRepo, refundPartialFulfillment, appendAll } = makeHarness()
    const order = makeOrder()
    orderRepo.seed(order)
    requestRepo.seed(makeRequest(order.id, { status: 'confirmed', respondedAt: NOW }))

    const result = await useCase.execute(cmd({ source: 'timeout' }))

    expect(result.status).toBe('confirmed')
    expect(refundPartialFulfillment).not.toHaveBeenCalled()
    expect(appendAll).not.toHaveBeenCalled()
  })

  it('гонка: transitionStatus проигран (запись уже НЕ awaiting_customer к моменту CAS) → no-op с актуальным статусом', async () => {
    const { useCase, orderRepo, requestRepo } = makeHarness()
    const order = makeOrder()
    orderRepo.seed(order)
    requestRepo.seed(makeRequest(order.id))
    const originalTransition = requestRepo.transitionStatus.bind(requestRepo)
    vi.spyOn(requestRepo, 'transitionStatus').mockImplementationOnce(async (input) => {
      // Симулирует победу конкурента МЕЖДУ нашим findById и нашим transitionStatus.
      await requestRepo.transitionStatus({ id: input.id, fromStatus: 'awaiting_customer', toStatus: 'rejected', respondedAt: NOW })
      return originalTransition(input)
    })

    const result = await useCase.execute(cmd({ source: 'timeout' }))

    expect(result.status).toBe('rejected')
  })
})

describe('ResolvePartialFulfillmentUseCase — confirmed=false (SRS-PHT-023, TC-PHT-012)', () => {
  it('весь заказ → cancelled, полный рефанд (non-cash), резерв ВСЕХ позиций восстановлен', async () => {
    const { useCase, orderRepo, requestRepo, releaseStock, refundFull } = makeHarness()
    const order = makeOrder('alif_mobi')
    orderRepo.seed(order)
    requestRepo.seed(makeRequest(order.id))

    const result = await useCase.execute(cmd({ confirmed: false }))

    expect(result.status).toBe('rejected')
    const saved = await orderRepo.findById(TENANT_ID, order.id)
    expect(saved?.status).toBe('cancelled')
    expect(releaseStock).toHaveBeenCalledExactlyOnceWith(
      order.items.map((item) => ({ inventoryBatchId: item.inventoryBatchId, quantity: item.quantity })),
    )
    expect(refundFull).toHaveBeenCalledExactlyOnceWith(order.id, 'customer_rejected_partial_fulfillment')
  })

  it('публикует PartialFulfillmentRejectedEvent + OrderCancelledEvent(reason=customer_rejected_partial_fulfillment)', async () => {
    const { useCase, orderRepo, requestRepo, appendAll } = makeHarness()
    const order = makeOrder()
    orderRepo.seed(order)
    requestRepo.seed(makeRequest(order.id))

    await useCase.execute(cmd({ confirmed: false }))

    expect(appendAll).toHaveBeenCalledExactlyOnceWith(
      TENANT_ID,
      expect.arrayContaining([
        expect.objectContaining({ type: 'OrderCancelledEvent', reason: 'customer_rejected_partial_fulfillment' }),
        expect.objectContaining({ type: 'PartialFulfillmentRejectedEvent', requestId: REQUEST_ID }),
      ]),
      undefined,
    )
  })

  it('cash_courier заказ → releaseStock вызван, refundFull НЕ вызван (D-25, наличные не в эскроу)', async () => {
    const { useCase, orderRepo, requestRepo, releaseStock, refundFull } = makeHarness()
    const order = makeOrder('cash_courier')
    orderRepo.seed(order)
    requestRepo.seed(makeRequest(order.id))

    await useCase.execute(cmd({ confirmed: false }))

    expect(releaseStock).toHaveBeenCalledOnce()
    expect(refundFull).not.toHaveBeenCalled()
  })

  it('refundFull возвращает Err → 503 PaymentProviderUnavailableError, отмена/release уже применены (не откатываются)', async () => {
    const { useCase, orderRepo, requestRepo, refundFull } = makeHarness()
    const order = makeOrder()
    orderRepo.seed(order)
    requestRepo.seed(makeRequest(order.id))
    const refundError: RefundError = { code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, message: 'bank down' }
    refundFull.mockResolvedValue(err(refundError))

    await expect(useCase.execute(cmd({ confirmed: false }))).rejects.toBeInstanceOf(PaymentProviderUnavailableError)

    const saved = await orderRepo.findById(TENANT_ID, order.id)
    expect(saved?.status).toBe('cancelled')
  })
})

describe('ResolvePartialFulfillmentUseCase — PAYMENT_PROVIDER_UNAVAILABLE (п.5 тикета, SRS-PHT-075)', () => {
  it('refundPartialFulfillment возвращает Err → 503, статус запроса УЖЕ confirmed и НЕ откатывается, retry-событие публикуется', async () => {
    const { useCase, orderRepo, requestRepo, appendAll, refundPartialFulfillment } = makeHarness()
    const order = makeOrder()
    orderRepo.seed(order)
    requestRepo.seed(makeRequest(order.id))
    const refundError: RefundError = { code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, message: 'bank down' }
    refundPartialFulfillment.mockResolvedValue(err(refundError))

    await expect(useCase.execute(cmd())).rejects.toBeInstanceOf(PaymentProviderUnavailableError)

    const settled = await requestRepo.findById(TENANT_ID, REQUEST_ID)
    expect(settled?.status).toBe('confirmed') // НЕ откатан
    const saved = await orderRepo.findById(TENANT_ID, order.id)
    expect(saved?.itemsTotal.diram).toBe(20_000n) // пересчёт суммы тоже НЕ откатан
    expect(appendAll).toHaveBeenCalledWith(
      TENANT_ID,
      expect.arrayContaining([expect.objectContaining({ type: 'PartialFulfillmentRefundRetryRequestedEvent', requestId: REQUEST_ID })]),
      undefined,
    )
  })
})
