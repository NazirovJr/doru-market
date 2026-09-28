import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, ValidationError } from '@dorutj/contracts'
import type { OrderAdminDetailView, OrdersFacadePort } from '../ports/orders-facade.port.js'
import type { PaymentsFacadePort } from '../ports/payments-facade.port.js'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
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
    requestId: null,
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
    refundFull: vi.fn(),
    adminPaymentOverride: adminPaymentOverrideMock,
  }
  const writeMock = vi.fn<AuditLogPort['write']>().mockResolvedValue(undefined)
  const auditLog: AuditLogPort = { write: writeMock }
  const useCase = new AdminPaymentOverrideUseCase(ordersFacade, paymentsFacade, auditLog)
  return { useCase, getOrderDetailMock, adminPaymentOverrideMock, writeMock }
}

describe('AdminPaymentOverrideUseCase (DTJ-356, SRS-ADM-032) — обёртка над payments/AdminPaymentOverrideUseCase (DTJ-246)', () => {
  it('AC1: reason короче 10 символов → ValidationError, ни override, ни audit не вызваны', async () => {
    const h = buildHarness()

    await expect(h.useCase.execute(baseCommand({ reason: 'коротко' }))).rejects.toBeInstanceOf(ValidationError)

    expect(h.adminPaymentOverrideMock).not.toHaveBeenCalled()
    expect(h.writeMock).not.toHaveBeenCalled()
  })

  it('AC2 (частично, см. JSDoc use case про неатомарность): валидный override → paymentsFacade.adminPaymentOverride + audit_log(category=payment_override, statusFrom/statusTo/orderTotalDiram)', async () => {
    const h = buildHarness({ order: makeOrder({ status: 'pending_payment', totalAmountDiram: 15_000 }) })

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
    })
    expect(h.writeMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        category: 'payment_override',
        entityType: 'order',
        entityId: 'order-1',
        action: 'admin_payment_override',
        metadata: { before: { status: 'pending_payment' }, after: { status: 'paid_escrow' }, extra: { orderTotalDiram: 15_000 } },
      }),
    )
    expect(result).toEqual({ orderId: 'order-1', status: 'paid_escrow' })
  })

  it('заказ не найден → NotFoundError, override не вызван', async () => {
    const h = buildHarness({ order: null })

    await expect(h.useCase.execute(baseCommand())).rejects.toBeInstanceOf(NotFoundError)
    expect(h.adminPaymentOverrideMock).not.toHaveBeenCalled()
  })
})
