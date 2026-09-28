import { describe, expect, it, vi } from 'vitest'
import { BusinessRuleViolationError, ConflictError, NotFoundError } from '@dorutj/contracts'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import type { UnitOfWorkPort } from '@/modules/auth/index.js'
import type { BillingInvoiceView, MarkInvoicePaidOutcome, PaymentsFacadePort } from '../ports/payments-facade.port.js'
import { MarkInvoicePaidUseCase } from './mark-invoice-paid.use-case.js'

const ACTOR = { userId: 'super-admin-1' }
const FAKE_TX = Symbol('tx')

const ISSUED_INVOICE: BillingInvoiceView = {
  id: 'invoice-1',
  chainId: 'chain-1',
  invoiceType: 'cash_courier_commission',
  status: 'issued',
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-08-31T00:00:00.000Z'),
  subtotalDiram: 10000,
  vatDiram: 1500,
  totalDiram: 11500,
  issuedAt: new Date('2026-09-01T00:00:00.000Z'),
  dueAt: new Date('2026-09-10T00:00:00.000Z'),
  paidAt: null,
}

const PAID_INVOICE: BillingInvoiceView = { ...ISSUED_INVOICE, status: 'paid', paidAt: new Date('2026-09-05T00:00:00.000Z') }

function buildHarness(options: {
  before?: BillingInvoiceView | null
  after?: BillingInvoiceView | null
  outcome?: MarkInvoicePaidOutcome
  auditWriteError?: Error
} = {}) {
  const before = options.before === undefined ? ISSUED_INVOICE : options.before
  const after = options.after === undefined ? PAID_INVOICE : options.after
  const outcome = options.outcome ?? 'paid'
  const getBillingInvoiceByIdMock = vi.fn<PaymentsFacadePort['getBillingInvoiceById']>()
  getBillingInvoiceByIdMock.mockResolvedValueOnce(before)
  getBillingInvoiceByIdMock.mockResolvedValueOnce(after)
  const markInvoicePaidMock = vi.fn<PaymentsFacadePort['markInvoicePaid']>().mockResolvedValue(outcome)
  const paymentsFacade: PaymentsFacadePort = {
    findEscrowLedgerEntries: vi.fn(),
    findPayoutSchedule: vi.fn(),
    findPayoutScheduleByOrder: vi.fn(),
    listBillingInvoices: vi.fn(),
    getBillingInvoiceById: getBillingInvoiceByIdMock,
    markInvoicePaid: markInvoicePaidMock,
    listCommissionRates: vi.fn(),
    upsertCommissionRate: vi.fn(),
  }
  const auditWriteMock =
    options.auditWriteError === undefined
      ? vi.fn<AuditLogPort['write']>().mockResolvedValue(undefined)
      : vi.fn<AuditLogPort['write']>().mockRejectedValue(options.auditWriteError)
  const auditLog: AuditLogPort = { write: auditWriteMock }
  let runCallCount = 0
  const unitOfWork: UnitOfWorkPort = {
    run: (cb) => {
      runCallCount += 1
      return cb(FAKE_TX)
    },
  }
  const useCase = new MarkInvoicePaidUseCase(paymentsFacade, unitOfWork, auditLog)
  return { useCase, getBillingInvoiceByIdMock, markInvoicePaidMock, auditWriteMock, getRunCallCount: () => runCallCount }
}

describe('MarkInvoicePaidUseCase (DTJ-359)', () => {
  it('успех → markInvoicePaid и audit.write выполняются внутри ОДНОГО unitOfWork.run с tx', async () => {
    const { useCase, markInvoicePaidMock, auditWriteMock, getRunCallCount } = buildHarness()

    const result = await useCase.execute({ invoiceId: 'invoice-1', actor: ACTOR, requestId: 'req-1' })

    expect(getRunCallCount()).toBe(1)
    expect(markInvoicePaidMock).toHaveBeenCalledWith('invoice-1', FAKE_TX)
    expect(auditWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'ledger_adjustment',
        entityType: 'billing_invoice',
        entityId: 'invoice-1',
        actorUserId: ACTOR.userId,
        action: 'mark_invoice_paid',
        metadata: { before: { status: 'issued' }, after: { status: 'paid' }, extra: { chainId: 'chain-1' } },
        requestId: 'req-1',
        tenantId: null,
      }),
    )
    expect(result).toEqual(PAID_INVOICE)
  })

  it('АС4: инвойс уже paid → ConflictError (409), не тихий no-op', async () => {
    const { useCase, auditWriteMock } = buildHarness({ before: PAID_INVOICE, outcome: 'already_paid' })

    await expect(useCase.execute({ invoiceId: 'invoice-1', actor: ACTOR, requestId: null })).rejects.toThrow(ConflictError)
    expect(auditWriteMock).not.toHaveBeenCalled()
  })

  it('инвойс не найден → NotFoundError, markInvoicePaid не вызывается', async () => {
    const { useCase, markInvoicePaidMock } = buildHarness({ before: null })

    await expect(useCase.execute({ invoiceId: 'missing', actor: ACTOR, requestId: null })).rejects.toThrow(NotFoundError)
    expect(markInvoicePaidMock).not.toHaveBeenCalled()
  })

  it('инвойс draft/void (invalid_status) → BusinessRuleViolationError', async () => {
    const { useCase } = buildHarness({ outcome: 'invalid_status' })

    await expect(useCase.execute({ invoiceId: 'invoice-1', actor: ACTOR, requestId: null })).rejects.toThrow(BusinessRuleViolationError)
  })

  it('audit.write() бросает → execute() отклоняется (mark-paid внутри незакоммиченной транзакции)', async () => {
    const { useCase, markInvoicePaidMock, auditWriteMock } = buildHarness({ auditWriteError: new Error('audit down') })

    await expect(useCase.execute({ invoiceId: 'invoice-1', actor: ACTOR, requestId: null })).rejects.toThrow('audit down')
    expect(markInvoicePaidMock).toHaveBeenCalledTimes(1)
    expect(auditWriteMock).toHaveBeenCalledTimes(1)
  })
})
