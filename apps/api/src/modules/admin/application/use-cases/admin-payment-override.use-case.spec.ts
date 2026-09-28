import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, ValidationError } from '@dorutj/contracts'
import type { OrderAdminDetailView, OrdersFacadePort } from '../ports/orders-facade.port.js'
import type { PaymentsFacadePort } from '../ports/payments-facade.port.js'
import { AdminPaymentOverrideUseCase, type AdminPaymentOverrideCommand } from './admin-payment-override.use-case.js'

const ACTOR = { userId: 'admin-1', role: 'super_admin' }

function makeOrder(overrides: Partial<OrderAdminDetailView> = {}): OrderAdminDetailView {
  return {
    id: 'order-1',
    orderNumber: 'DTJ-260927-00001',
    status: 'pending_payment',
    tenantId: 'tenant-1',
    pharmacyId: 'pharmacy-1',
    customerId: 'customer-1',
    paymentMethod: 'alif_mobi',
    totalAmountDiram: 15_000,
    prescriptionId: null,
    createdAt: new Date('2026-09-27T10:00:00.000Z'),
    ...overrides,
  }
}

function baseCommand(overrides: Partial<AdminPaymentOverrideCommand> = {}): AdminPaymentOverrideCommand {
  return {
    orderId: 'order-1',
    reason: 'банк подтвердил оплату по телефону, ref #12345',
    txId: 'manual-tx-1',
    amountDiram: 15_000n,
    paidAt: new Date('2026-09-27T11:00:00.000Z'),
    actor: ACTOR,
    requestId: 'req-1',
    ...overrides,
  }
}

function buildHarness(params: { readonly order?: OrderAdminDetailView | null } = {}) {
  const order = params.order === undefined ? makeOrder() : params.order
  const getOrderDetailMock = vi.fn<OrdersFacadePort['getOrderDetail']>().mockResolvedValue(order)
  const ordersFacade: OrdersFacadePort = {
    findOrdersAny: vi.fn(),
    getOrderDetail: getOrderDetailMock,
    getOrderTimeline: vi.fn(),
    cancel: vi.fn(),
  }
  const adminPaymentOverrideMock = vi.fn<PaymentsFacadePort['adminPaymentOverride']>().mockResolvedValue(undefined)
  const paymentsFacade: PaymentsFacadePort = {
    findEscrowLedgerEntries: vi.fn(),
    findPayoutSchedule: vi.fn(),
    findPayoutScheduleByOrder: vi.fn(),
    listBillingInvoices: vi.fn(),
    getBillingInvoiceById: vi.fn(),
    markInvoicePaid: vi.fn(),
    listCommissionRates: vi.fn(),
    upsertCommissionRate: vi.fn(),
    refundFull: vi.fn(),
    adminPaymentOverride: adminPaymentOverrideMock,
  }
  const useCase = new AdminPaymentOverrideUseCase(ordersFacade, paymentsFacade)
  return { useCase, getOrderDetailMock, adminPaymentOverrideMock }
}

describe('AdminPaymentOverrideUseCase (DTJ-356) — обёртка над payments/AdminPaymentOverrideUseCase (DTJ-246), второй вход, без второго audit', () => {
  it('AC1: reason короче 10 символов → ValidationError, override не вызван', async () => {
    const h = buildHarness()

    await expect(h.useCase.execute(baseCommand({ reason: 'коротко' }))).rejects.toBeInstanceOf(ValidationError)

    expect(h.adminPaymentOverrideMock).not.toHaveBeenCalled()
  })

  it('валидный override: резолвит tenantId кросс-тенантно и делегирует в PaymentsFacadePort.adminPaymentOverride с requestId', async () => {
    const h = buildHarness({ order: makeOrder({ tenantId: 'tenant-1' }) })

    const result = await h.useCase.execute(baseCommand())

    expect(h.adminPaymentOverrideMock).toHaveBeenCalledExactlyOnceWith({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      txId: 'manual-tx-1',
      amountDiram: 15_000n,
      paidAt: baseCommand().paidAt,
      reason: baseCommand().reason,
      actorUserId: 'admin-1',
      actorRole: 'super_admin',
      requestId: 'req-1',
    })
    expect(result).toEqual({ orderId: 'order-1', status: 'paid_escrow' })
  })

  it('заказ не найден (кросс-тенантно) → NotFoundError, override не вызван', async () => {
    const h = buildHarness({ order: null })

    await expect(h.useCase.execute(baseCommand())).rejects.toBeInstanceOf(NotFoundError)
    expect(h.adminPaymentOverrideMock).not.toHaveBeenCalled()
  })
})
