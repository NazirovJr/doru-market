/**
 * Unit-тесты `AdminPaymentOverrideUseCase` (EP-10, DTJ-246; атомарность audit — DTJ-356) —
 * все порты замоканы.
 */
import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError, ValidationError } from '@dorutj/contracts'
import type { EscrowLedgerRepository } from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import type { PaymentsOrderSnapshot, PaymentsOrdersPort, PaymentsUnitOfWorkTx } from '@/modules/payments/application/ports/orders-facade.port.js'
import type { PaymentsUnitOfWorkPort } from '@/modules/payments/application/ports/payments-unit-of-work.port.js'
import type { AuditLogPort } from '@/modules/payments/application/ports/audit-log.port.js'
import { AdminPaymentOverrideUseCase, type AdminPaymentOverrideCommand } from './admin-payment-override.use-case.js'

const TX_MARKER: PaymentsUnitOfWorkTx = { marker: 'tx' }

function baseCommand(overrides: Partial<AdminPaymentOverrideCommand> = {}): AdminPaymentOverrideCommand {
  return {
    tenantId: 'tenant-1',
    orderId: 'order-1',
    txId: 'manual-tx-1',
    amountDiram: 15_000n,
    paidAt: new Date('2026-09-04T10:00:00Z'),
    reason: 'confirmed by bank support over phone, call ref #12345',
    actorUserId: 'admin-1',
    actorRole: 'super_admin',
    requestId: 'req-1',
    ...overrides,
  }
}

function baseOrder(overrides: Partial<PaymentsOrderSnapshot> = {}): PaymentsOrderSnapshot {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    pharmacyId: 'pharmacy-1',
    status: 'pending_payment',
    paymentMethod: 'alif_mobi',
    totalAmountDiram: 15_000n,
    pharmacyChainId: null,
    items: [],
    billingStrategy: 'single_invoice',
    ...overrides,
  }
}

function buildHarness(params: { readonly order?: PaymentsOrderSnapshot | null } = {}) {
  const order = params.order === undefined ? baseOrder() : params.order
  const getOrderById = vi.fn<PaymentsOrdersPort['getOrderById']>().mockResolvedValue(order)
  const markPaidEscrow = vi.fn<PaymentsOrdersPort['markPaidEscrow']>().mockResolvedValue(undefined)
  const ordersPort = { getOrderById, markPaidEscrow, cancel: vi.fn() }
  const append = vi.fn<EscrowLedgerRepository['append']>().mockResolvedValue(undefined)
  const ledgerRepository = { append } as unknown as EscrowLedgerRepository
  const appendPaymentOverride = vi.fn<AuditLogPort['appendPaymentOverride']>().mockResolvedValue(undefined)
  const auditLog = { appendPaymentOverride }
  const unitOfWork: PaymentsUnitOfWorkPort = { run: (cb) => cb(TX_MARKER) }

  const useCase = new AdminPaymentOverrideUseCase(ordersPort, ledgerRepository, auditLog, unitOfWork)
  return { useCase, getOrderById, markPaidEscrow, append, appendPaymentOverride }
}

describe('AdminPaymentOverrideUseCase (DTJ-246, атомарность audit — DTJ-356)', () => {
  it('AC1: валидный super_admin с reason → markPaidEscrow + escrow_ledger(hold_created) + audit_log(payment_override), все с ОДНИМ tx', async () => {
    const h = buildHarness()

    await h.useCase.execute(baseCommand())

    expect(h.markPaidEscrow).toHaveBeenCalledWith('tenant-1', 'order-1', 'manual-tx-1', expect.any(Date), TX_MARKER)
    expect(h.append).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ orderId: 'order-1', entryType: 'hold_created', direction: 'debit' }),
      TX_MARKER,
    )
    expect(h.appendPaymentOverride).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId: 'tenant-1', entityId: 'order-1', action: 'admin_payment_override', actorUserId: 'admin-1', requestId: 'req-1' }),
      TX_MARKER,
    )
    const auditInput = h.appendPaymentOverride.mock.calls[0]?.[0] as unknown as {
      readonly metadata: { statusFrom: string; statusTo: string; orderTotalDiram: number }
    }
    expect(auditInput.metadata).toMatchObject({ statusFrom: 'pending_payment', statusTo: 'paid_escrow', orderTotalDiram: 15_000 })
  })

  it('AC2: reason пустой → ValidationError, транзакция НЕ начата (unitOfWork/markPaidEscrow не вызваны)', async () => {
    const h = buildHarness()

    await expect(h.useCase.execute(baseCommand({ reason: '   ' }))).rejects.toBeInstanceOf(ValidationError)

    expect(h.markPaidEscrow).not.toHaveBeenCalled()
    expect(h.append).not.toHaveBeenCalled()
  })

  it('AC3: actor НЕ super_admin (вызов в обход presentation-guard) → ForbiddenError, мутация НЕ выполняется', async () => {
    const h = buildHarness()

    await expect(h.useCase.execute(baseCommand({ actorRole: 'pharmacy_admin' }))).rejects.toBeInstanceOf(ForbiddenError)

    expect(h.markPaidEscrow).not.toHaveBeenCalled()
    expect(h.append).not.toHaveBeenCalled()
    expect(h.appendPaymentOverride).not.toHaveBeenCalled()
  })

  it('заказ не найден → NotFoundError, markPaidEscrow НЕ вызывается', async () => {
    const h = buildHarness({ order: null })

    await expect(h.useCase.execute(baseCommand())).rejects.toBeInstanceOf(NotFoundError)
    expect(h.markPaidEscrow).not.toHaveBeenCalled()
  })

  it('порядок вызовов внутри unitOfWork: markPaidEscrow → ledger.append → audit (последним, но в ТОЙ ЖЕ транзакции)', async () => {
    const h = buildHarness()
    const callOrder: string[] = []
    h.markPaidEscrow.mockImplementation(() => {
      callOrder.push('markPaidEscrow')
      return Promise.resolve()
    })
    h.append.mockImplementation(() => {
      callOrder.push('ledgerAppend')
      return Promise.resolve()
    })
    h.appendPaymentOverride.mockImplementation(() => {
      callOrder.push('auditLog')
      return Promise.resolve()
    })

    await h.useCase.execute(baseCommand())

    expect(callOrder).toEqual(['markPaidEscrow', 'ledgerAppend', 'auditLog'])
  })

  it('DTJ-356: AuditLogPort.appendPaymentOverride бросает → execute() пробрасывает ошибку (unitOfWork откатывает markPaidEscrow/ledger вместе с ней, не тихий успех)', async () => {
    const h = buildHarness()
    h.appendPaymentOverride.mockRejectedValue(new Error('audit db down'))

    await expect(h.useCase.execute(baseCommand())).rejects.toThrow('audit db down')

    expect(h.markPaidEscrow).toHaveBeenCalledOnce()
  })
})
