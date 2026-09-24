/**
 * Unit-тесты `RefundOnReturnResolvedUseCase` (EP-11, DTJ-274, тест-план тикета) — все порты
 * замоканы (1:1 приём `CaptureEscrowUseCase.spec.ts`, `modules/payments`, DTJ-244).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import type { OrderReturnContext, ReturnsOrdersPort } from '../ports/orders-facade.port.js'
import type { ReturnsPaymentsPort } from '../ports/payments-facade.port.js'
import type { ProcessedEventsPort } from '@/common/events/processed-events.port.js'
import type { ReturnsUnitOfWorkPort } from '../ports/returns-unit-of-work.port.js'
import { ReturnFinancialOutcomeResolver } from '../policies/return-financial-outcome.policy.js'
import { RefundOnReturnResolvedUseCase, type RefundOnReturnResolvedCommand } from './refund-on-return-resolved.use-case.js'

const TX_MARKER = { marker: 'tx' }
const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

const CMD: RefundOnReturnResolvedCommand = {
  tenantId: 'tenant-1',
  returnId: 'return-1',
  orderId: 'order-1',
  reason: 'defect',
  disposition: 'restock',
  eventId: 'evt-1',
}

function makeOrder(overrides: Partial<OrderReturnContext> = {}): OrderReturnContext {
  return {
    orderId: 'order-1',
    status: 'return_confirmed',
    pharmacyId: 'pharmacy-1',
    chainId: null,
    customerId: 'customer-1',
    paymentMethod: 'alif_mobi',
    billingStrategy: 'single_invoice',
    deliveredAt: new Date('2026-09-01T00:00:00.000Z'),
    courierId: null,
    items: [],
    itemsTotalDiram: 5_000n,
    deliveryFeeDiram: 1_000n,
    totalAmountDiram: 6_000n,
    ...overrides,
  }
}

function buildHarness(orderOverrides: Partial<OrderReturnContext> = {}) {
  const markProcessed = vi.fn<ProcessedEventsPort['markProcessed']>().mockResolvedValue(true)
  const processedEvents: ProcessedEventsPort = { markProcessed }
  const getOrderForReturn = vi.fn<ReturnsOrdersPort['getOrderForReturn']>().mockResolvedValue(makeOrder(orderOverrides))
  const getCourierIdForUser = vi.fn<ReturnsOrdersPort['getCourierIdForUser']>().mockResolvedValue(null)
  const ordersPort: ReturnsOrdersPort = { getOrderForReturn, getCourierIdForUser }
  const refundItems = vi.fn<ReturnsPaymentsPort['refundItems']>().mockResolvedValue(undefined)
  const refundDelivery = vi.fn<ReturnsPaymentsPort['refundDelivery']>().mockResolvedValue(undefined)
  const refundFull = vi.fn<ReturnsPaymentsPort['refundFull']>().mockResolvedValue(undefined)
  const recordAdjustment = vi.fn<ReturnsPaymentsPort['recordAdjustment']>().mockResolvedValue(undefined)
  const paymentsPort: ReturnsPaymentsPort = { refundItems, refundDelivery, refundFull, recordAdjustment }
  const unitOfWork: ReturnsUnitOfWorkPort = { run: (cb) => cb(TX_MARKER) }
  const financialOutcomeResolver = new ReturnFinancialOutcomeResolver()

  const useCase = new RefundOnReturnResolvedUseCase(processedEvents, ordersPort, paymentsPort, unitOfWork, SILENT_LOGGER, financialOutcomeResolver)
  return { useCase, markProcessed, getOrderForReturn, refundItems, refundDelivery, refundFull, recordAdjustment }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RefundOnReturnResolvedUseCase (DTJ-274)', () => {
  it('AC — split_items_delivery + возврат только items (reason=undeliverable, ITEMS_ONLY_REFUND) — refundItems вызван, refundDelivery НЕ вызван (TC-RET-004-подобный)', async () => {
    const h = buildHarness({ billingStrategy: 'split_items_delivery' })

    await h.useCase.execute({ ...CMD, reason: 'undeliverable' })

    expect(h.refundItems).toHaveBeenCalledExactlyOnceWith('tenant-1', { orderId: 'order-1', returnId: 'return-1', amountDiram: 5_000n }, TX_MARKER)
    expect(h.refundDelivery).not.toHaveBeenCalled()
    expect(h.refundFull).not.toHaveBeenCalled()
    expect(h.recordAdjustment).not.toHaveBeenCalled()
  })

  it('split_items_delivery + FULL_REFUND (reason=defect) — обе части возвращены по отдельности', async () => {
    const h = buildHarness({ billingStrategy: 'split_items_delivery' })

    await h.useCase.execute(CMD)

    expect(h.refundItems).toHaveBeenCalledExactlyOnceWith('tenant-1', { orderId: 'order-1', returnId: 'return-1', amountDiram: 5_000n }, TX_MARKER)
    expect(h.refundDelivery).toHaveBeenCalledExactlyOnceWith('tenant-1', { orderId: 'order-1', returnId: 'return-1', amountDiram: 1_000n }, TX_MARKER)
    expect(h.refundFull).not.toHaveBeenCalled()
  })

  it('single_invoice + FULL_REFUND (reason=defect) — простой refundFull, БЕЗ adjustment (п.6 тикета)', async () => {
    const h = buildHarness({ billingStrategy: 'single_invoice' })

    await h.useCase.execute(CMD)

    expect(h.refundFull).toHaveBeenCalledExactlyOnceWith('tenant-1', { orderId: 'order-1', returnId: 'return-1', amountDiram: 6_000n }, TX_MARKER)
    expect(h.recordAdjustment).not.toHaveBeenCalled()
  })

  it('AC2/TC-RET-005 — single_invoice + ITEMS_ONLY_REFUND (reason=undeliverable, supportsPartialRefund=false) — refundFull ПОЛНЫЙ + adjustment на deliveryFeeDiram', async () => {
    const h = buildHarness({ billingStrategy: 'single_invoice' })

    await h.useCase.execute({ ...CMD, reason: 'undeliverable', disposition: 'destroy' })

    expect(h.refundFull).toHaveBeenCalledExactlyOnceWith('tenant-1', { orderId: 'order-1', returnId: 'return-1', amountDiram: 6_000n }, TX_MARKER)
    expect(h.recordAdjustment).toHaveBeenCalledExactlyOnceWith(
      'tenant-1',
      expect.objectContaining({ orderId: 'order-1', returnId: 'return-1', amountDiram: 1_000n, actorUserId: '00000000-0000-0000-0000-000000000000' }),
      TX_MARKER,
    )
  })

  it('NO_REFUND (customer_dispute_post_delivery + disposition=destroy) — ни один платёжный метод не вызван', async () => {
    const h = buildHarness({ billingStrategy: 'single_invoice' })

    await h.useCase.execute({ ...CMD, reason: 'customer_dispute_post_delivery', disposition: 'destroy' })

    expect(h.refundFull).not.toHaveBeenCalled()
    expect(h.refundItems).not.toHaveBeenCalled()
    expect(h.refundDelivery).not.toHaveBeenCalled()
    expect(h.recordAdjustment).not.toHaveBeenCalled()
  })

  it('customer_dispute_post_delivery + disposition=restock — FULL_REFUND (подтверждённый брак)', async () => {
    const h = buildHarness({ billingStrategy: 'single_invoice' })

    await h.useCase.execute({ ...CMD, reason: 'customer_dispute_post_delivery', disposition: 'restock' })

    expect(h.refundFull).toHaveBeenCalledExactlyOnceWith('tenant-1', { orderId: 'order-1', returnId: 'return-1', amountDiram: 6_000n }, TX_MARKER)
  })

  it('AC3/TC-RET-007 — payment_method=cash_courier — PaymentsPort НЕ вызван ни разу (негативный сценарий)', async () => {
    const h = buildHarness({ paymentMethod: 'cash_courier' })

    await h.useCase.execute(CMD)

    expect(h.refundFull).not.toHaveBeenCalled()
    expect(h.refundItems).not.toHaveBeenCalled()
    expect(h.refundDelivery).not.toHaveBeenCalled()
    expect(h.recordAdjustment).not.toHaveBeenCalled()
    expect(h.getOrderForReturn).toHaveBeenCalledOnce() // заказ всё же читается — paymentMethod проверяется ПЕРВЫМ шагом ПОСЛЕ загрузки
  })

  it('AC4 — идемпотентность: markProcessed вернул false (повторная доставка) — заказ не читается, refund не вызывается повторно', async () => {
    const h = buildHarness()
    h.markProcessed.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await h.useCase.execute(CMD)
    await h.useCase.execute(CMD)

    expect(h.refundFull).toHaveBeenCalledOnce()
    expect(h.getOrderForReturn).toHaveBeenCalledOnce()
  })
})
