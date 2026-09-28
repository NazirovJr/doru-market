import { describe, expect, it, vi } from 'vitest'
import { BusinessRuleViolationError, ForbiddenError, InvalidOrderStatusTransitionError, NotFoundError, ValidationError } from '@dorutj/contracts'
import type { OrderAdminDetailView, OrdersFacadePort } from '../ports/orders-facade.port.js'
import type { PaymentsFacadePort } from '../ports/payments-facade.port.js'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import type { UnitOfWorkPort } from '@/modules/auth/index.js'
import { AdminForceCancelOrderUseCase, type AdminForceCancelOrderCommand } from './admin-force-cancel-order.use-case.js'

const SUPER_ADMIN_ACTOR = { userId: 'admin-1', role: 'super_admin' }

function makeOrder(overrides: Partial<OrderAdminDetailView> = {}): OrderAdminDetailView {
  return {
    id: 'order-1',
    orderNumber: 'DTJ-260927-00001',
    status: 'processing',
    tenantId: 'tenant-1',
    pharmacyId: 'pharmacy-1',
    customerId: 'customer-1',
    paymentMethod: 'alif_mobi',
    totalAmountDiram: 12_345,
    prescriptionId: null,
    createdAt: new Date('2026-09-27T10:00:00.000Z'),
    ...overrides,
  }
}

function baseCommand(overrides: Partial<AdminForceCancelOrderCommand> = {}): AdminForceCancelOrderCommand {
  return {
    orderId: 'order-1',
    reason: 'обнаружена поддельная лицензия рецепта, инцидент INC-2044',
    actor: SUPER_ADMIN_ACTOR,
    requestId: null,
    ...overrides,
  }
}

function buildHarness(params: { readonly order?: OrderAdminDetailView | null; readonly cancelError?: Error } = {}) {
  const order = params.order === undefined ? makeOrder() : params.order
  const getOrderDetailMock = vi.fn<OrdersFacadePort['getOrderDetail']>().mockResolvedValue(order)
  const cancelMock = vi.fn<OrdersFacadePort['cancel']>()
  if (params.cancelError !== undefined) {
    cancelMock.mockRejectedValue(params.cancelError)
  } else {
    cancelMock.mockResolvedValue(undefined)
  }
  const ordersFacade: OrdersFacadePort = {
    findOrdersAny: vi.fn(),
    getOrderDetail: getOrderDetailMock,
    getOrderTimeline: vi.fn(),
    cancel: cancelMock,
  }
  const refundFullMock = vi.fn<PaymentsFacadePort['refundFull']>().mockResolvedValue(undefined)
  const paymentsFacade: PaymentsFacadePort = {
    findEscrowLedgerEntries: vi.fn(),
    findPayoutSchedule: vi.fn(),
    findPayoutScheduleByOrder: vi.fn(),
    listBillingInvoices: vi.fn(),
    getBillingInvoiceById: vi.fn(),
    markInvoicePaid: vi.fn(),
    listCommissionRates: vi.fn(),
    upsertCommissionRate: vi.fn(),
    refundFull: refundFullMock,
    adminPaymentOverride: vi.fn(),
  }
  const writeMock = vi.fn<AuditLogPort['write']>().mockResolvedValue(undefined)
  const auditLog: AuditLogPort = { write: writeMock }
  const unitOfWork: UnitOfWorkPort = { run: (cb) => cb({}) }
  const useCase = new AdminForceCancelOrderUseCase(ordersFacade, paymentsFacade, auditLog, unitOfWork)
  return { useCase, getOrderDetailMock, cancelMock, refundFullMock, writeMock }
}

describe('AdminForceCancelOrderUseCase (DTJ-356, SRS-DOM-171/SRS-ADM-033)', () => {
  it('успех: cancel + audit_log(category=force_cancel_order) в одном unitOfWork, заказ был оплачен → refundFull вызван', async () => {
    const h = buildHarness({ order: makeOrder({ status: 'processing', paymentMethod: 'alif_mobi' }) })

    const result = await h.useCase.execute(baseCommand())

    expect(h.cancelMock).toHaveBeenCalledExactlyOnceWith(
      'order-1',
      expect.objectContaining({ tenantId: 'tenant-1', reason: 'fraud_or_safety_force_cancel', actor: { kind: 'user', userId: 'admin-1' } }),
      expect.anything(),
    )
    expect(h.writeMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ category: 'force_cancel_order', entityType: 'order', entityId: 'order-1', action: 'admin_force_cancel_order' }),
    )
    expect(h.refundFullMock).toHaveBeenCalledExactlyOnceWith('tenant-1', { orderId: 'order-1', reason: baseCommand().reason })
    expect(result).toEqual({ orderId: 'order-1', status: 'cancelled', refundIssued: true })
  })

  it('cash_courier — refundFull НЕ вызывается', async () => {
    const h = buildHarness({ order: makeOrder({ paymentMethod: 'cash_courier', status: 'processing' }) })

    const result = await h.useCase.execute(baseCommand())

    expect(h.refundFullMock).not.toHaveBeenCalled()
    expect(result.refundIssued).toBe(false)
  })

  it('reason короче 10 символов → ValidationError, ни cancel, ни audit не вызваны', async () => {
    const h = buildHarness()

    await expect(h.useCase.execute(baseCommand({ reason: 'слишком' }))).rejects.toBeInstanceOf(ValidationError)

    expect(h.cancelMock).not.toHaveBeenCalled()
    expect(h.writeMock).not.toHaveBeenCalled()
  })

  it('actor не super_admin → ForbiddenError, facade не вызван (второй рубеж поверх @Roles guard)', async () => {
    const h = buildHarness()

    await expect(h.useCase.execute(baseCommand({ actor: { userId: 'x', role: 'pharmacy_admin' } }))).rejects.toBeInstanceOf(ForbiddenError)
    expect(h.cancelMock).not.toHaveBeenCalled()
  })

  it('заказ не найден → NotFoundError', async () => {
    const h = buildHarness({ order: null })

    await expect(h.useCase.execute(baseCommand())).rejects.toBeInstanceOf(NotFoundError)
    expect(h.cancelMock).not.toHaveBeenCalled()
  })

  it('AC3 — заказ delivered (недопустимый переход в домене) → 422 BusinessRuleViolationError, audit_log НЕ пишется', async () => {
    const h = buildHarness({
      order: makeOrder({ status: 'delivered' }),
      cancelError: new InvalidOrderStatusTransitionError({ orderId: 'order-1', from: 'delivered', to: 'cancelled' }),
    })

    await expect(h.useCase.execute(baseCommand())).rejects.toBeInstanceOf(BusinessRuleViolationError)

    expect(h.writeMock).not.toHaveBeenCalled()
    expect(h.refundFullMock).not.toHaveBeenCalled()
  })

  it('AuditLogPort.write бросает исключение ПОСЛЕ успешного cancel — исключение пробрасывается наружу (unitOfWork откатывает cancel)', async () => {
    const h = buildHarness()
    h.writeMock.mockRejectedValue(new Error('audit db down'))

    await expect(h.useCase.execute(baseCommand())).rejects.toThrow('audit db down')

    expect(h.cancelMock).toHaveBeenCalledOnce()
    expect(h.refundFullMock).not.toHaveBeenCalled()
  })
})
