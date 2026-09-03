/**
 * `RetryPaymentUseCase` (EP-10, DTJ-241, SRS-PAY-041) — unit-набор. `OrdersFacade` — РЕАЛЬНЫЙ
 * инстанс поверх `InMemoryOrderRepository` (тот же приём, что `cancel-order.use-case.spec.ts`),
 * `PaymentInvoicePort` — `vi.fn()`-мок (отдельная переменная `createInvoice`, не
 * `paymentInvoice.createInvoice` — `@typescript-eslint/unbound-method`, тот же приём, что
 * `cancel-order.use-case.spec.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import type { InvoiceRef, PaymentInvoicePort } from '@/modules/orders/application/ports/payment-invoice.port.js'
import { OrderNotRetryableError } from './errors/order-not-retryable.error.js'
import { RetryPaymentUseCase, type RetryPaymentCommand } from './retry-payment.use-case.js'

const TENANT_ID = 'tenant-1'
const CUSTOMER_ID = 'customer-1'

function orderAtStatus(status: OrderSnapshot['status'], overrides: Partial<OrderSnapshot> = {}): Order {
  const created = Order.create(validOrderCreateCommand({ paymentMethod: 'alif_mobi' }))
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({ ...created.value.toSnapshot(), status, ...overrides })
}

function baseCommand(orderId: string, overrides: Partial<RetryPaymentCommand> = {}): RetryPaymentCommand {
  return {
    tenantId: TENANT_ID,
    orderId,
    customerId: CUSTOMER_ID,
    customerPhone: '+992900000000',
    idempotencyKey: 'retry-key-1',
    ...overrides,
  }
}

describe('RetryPaymentUseCase (DTJ-241)', () => {
  let repository: InMemoryOrderRepository
  let ordersFacade: OrdersFacade
  let createInvoice: ReturnType<typeof vi.fn<PaymentInvoicePort['createInvoice']>>
  let paymentInvoice: PaymentInvoicePort

  beforeEach(() => {
    repository = new InMemoryOrderRepository()
    ordersFacade = new OrdersFacade(repository)
    createInvoice = vi.fn<PaymentInvoicePort['createInvoice']>()
    paymentInvoice = { createInvoice }
  })

  it('AC3 — pending_payment без payment_transaction_id → вызывает PaymentInvoicePort.createInvoice с полями заказа, возвращает InvoiceRef', async () => {
    const order = orderAtStatus('pending_payment', { paymentTransactionId: null })
    repository.seed(order)
    const invoiceRef: InvoiceRef = { providerRef: 'alif_bill_1', qrPayload: 'https://checkout.alif.tj/?invoice=alif_bill_1', expiresAt: new Date() }
    createInvoice.mockResolvedValue({ ok: true, value: invoiceRef })
    const useCase = new RetryPaymentUseCase(ordersFacade, paymentInvoice)

    const result = await useCase.execute(baseCommand(order.id))

    expect(result).toEqual(invoiceRef)
    expect(createInvoice).toHaveBeenCalledWith({
      orderId: order.id,
      amountDiram: order.totalAmount.diram,
      currency: 'TJS',
      idempotencyKey: 'retry-key-1',
      description: `DoruTJ order ${order.orderNumber.value}`,
      customerPhone: '+992900000000',
    })
  })

  it('AC4 — заказ paid_escrow → OrderNotRetryableError, createInvoice НЕ вызывается', async () => {
    const order = orderAtStatus('paid_escrow', { paymentTransactionId: 'mock_txn_1' })
    repository.seed(order)
    const useCase = new RetryPaymentUseCase(ordersFacade, paymentInvoice)

    await expect(useCase.execute(baseCommand(order.id))).rejects.toBeInstanceOf(OrderNotRetryableError)
    expect(createInvoice).not.toHaveBeenCalled()
  })

  it('pending_payment, но payment_transaction_id уже проставлен (испорченная строка) → OrderNotRetryableError', async () => {
    const order = orderAtStatus('pending_payment', { paymentTransactionId: 'unexpected' })
    repository.seed(order)
    const useCase = new RetryPaymentUseCase(ordersFacade, paymentInvoice)

    await expect(useCase.execute(baseCommand(order.id))).rejects.toBeInstanceOf(OrderNotRetryableError)
  })

  it('несуществующий заказ → NotFoundError', async () => {
    const useCase = new RetryPaymentUseCase(ordersFacade, paymentInvoice)
    await expect(useCase.execute(baseCommand('does-not-exist'))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('чужой тенант → NotFoundError (SRS-API-046, не 403 — существование чужой строки не подтверждается)', async () => {
    const order = orderAtStatus('pending_payment', { paymentTransactionId: null, tenantId: 'other-tenant' })
    repository.seed(order)
    const useCase = new RetryPaymentUseCase(ordersFacade, paymentInvoice)

    await expect(useCase.execute(baseCommand(order.id))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('чужой customer (тот же тенант) → ForbiddenError', async () => {
    const order = orderAtStatus('pending_payment', { paymentTransactionId: null })
    repository.seed(order)
    const useCase = new RetryPaymentUseCase(ordersFacade, paymentInvoice)

    await expect(useCase.execute(baseCommand(order.id, { customerId: 'someone-else' }))).rejects.toBeInstanceOf(ForbiddenError)
    expect(createInvoice).not.toHaveBeenCalled()
  })

  it('PaymentInvoicePort возвращает Err → бросает (не проглатывает)', async () => {
    const order = orderAtStatus('pending_payment', { paymentTransactionId: null })
    repository.seed(order)
    createInvoice.mockResolvedValue({
      ok: false,
      error: { code: 'PAYMENT_PROVIDER_UNAVAILABLE' as never, message: 'bank unreachable' },
    })
    const useCase = new RetryPaymentUseCase(ordersFacade, paymentInvoice)

    await expect(useCase.execute(baseCommand(order.id))).rejects.toThrow(/bank unreachable/)
  })
})
