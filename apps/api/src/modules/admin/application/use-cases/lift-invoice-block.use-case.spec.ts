import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, ValidationError } from '@dorutj/contracts'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import type { UnitOfWorkPort } from '@/modules/auth/index.js'
import type { OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import type { BillingInvoiceView, PaymentsFacadePort } from '../ports/payments-facade.port.js'
import { LiftInvoiceBlockUseCase } from './lift-invoice-block.use-case.js'

const ACTOR = { userId: 'super-admin-1' }
const FAKE_TX = Symbol('tx')

const OVERDUE_INVOICE: BillingInvoiceView = {
  id: 'invoice-1',
  chainId: 'chain-1',
  invoiceType: 'cash_courier_commission',
  status: 'overdue',
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-08-31T00:00:00.000Z'),
  subtotalDiram: 10000,
  vatDiram: 1500,
  totalDiram: 11500,
  issuedAt: new Date('2026-09-01T00:00:00.000Z'),
  dueAt: new Date('2026-09-10T00:00:00.000Z'),
  paidAt: null,
}

function buildHarness(options: { invoice?: BillingInvoiceView | null; liftInvoiceBlockError?: Error; auditWriteError?: Error } = {}) {
  const invoice = options.invoice === undefined ? OVERDUE_INVOICE : options.invoice
  const getBillingInvoiceByIdMock = vi.fn<PaymentsFacadePort['getBillingInvoiceById']>().mockResolvedValue(invoice)
  const paymentsFacade: PaymentsFacadePort = {
    findEscrowLedgerEntries: vi.fn(),
    findPayoutSchedule: vi.fn(),
    findPayoutScheduleByOrder: vi.fn(),
    refundFull: vi.fn(),
    adminPaymentOverride: vi.fn(),
    listBillingInvoices: vi.fn(),
    getBillingInvoiceById: getBillingInvoiceByIdMock,
    markInvoicePaid: vi.fn(),
    listCommissionRates: vi.fn(),
    upsertCommissionRate: vi.fn(),
  }
  const liftInvoiceBlockMock =
    options.liftInvoiceBlockError === undefined
      ? vi.fn<OnboardingFacadePort['liftInvoiceBlock']>().mockResolvedValue(undefined)
      : vi.fn<OnboardingFacadePort['liftInvoiceBlock']>().mockRejectedValue(options.liftInvoiceBlockError)
  const onboardingFacade: OnboardingFacadePort = {
    findPharmacyAccountsAny: vi.fn(),
    getPharmacyChainId: vi.fn(),
    getScheduleAndZone: vi.fn(),
    updateSchedule: vi.fn(),
    updateDeliveryZone: vi.fn(),
    liftInvoiceBlock: liftInvoiceBlockMock,
    findChainNames: vi.fn(),
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
  const useCase = new LiftInvoiceBlockUseCase(paymentsFacade, onboardingFacade, unitOfWork, auditLog)
  return { useCase, getBillingInvoiceByIdMock, liftInvoiceBlockMock, auditWriteMock, getRunCallCount: () => runCallCount }
}

describe('LiftInvoiceBlockUseCase (DTJ-359)', () => {
  it('АС3: валидный вызов → liftInvoiceBlock и audit.write в ОДНОМ unitOfWork.run, аудит ПОСЛЕ смены статуса', async () => {
    const { useCase, liftInvoiceBlockMock, auditWriteMock, getRunCallCount } = buildHarness()

    await useCase.execute({ invoiceId: 'invoice-1', rawBody: { reason: 'invoice paid by bank transfer' }, actor: ACTOR, requestId: 'req-1' })

    expect(getRunCallCount()).toBe(1)
    expect(liftInvoiceBlockMock).toHaveBeenCalledWith('chain-1', { id: ACTOR.userId }, FAKE_TX)
    expect(auditWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'ledger_adjustment',
        entityType: 'billing_invoice',
        entityId: 'invoice-1',
        actorUserId: ACTOR.userId,
        action: 'lift_invoice_block',
        reason: 'invoice paid by bank transfer',
        metadata: { extra: { chainId: 'chain-1' } },
        requestId: 'req-1',
        tenantId: null,
      }),
    )
    const liftOrder = liftInvoiceBlockMock.mock.invocationCallOrder[0]
    const auditOrder = auditWriteMock.mock.invocationCallOrder[0]
    expect(liftOrder).toBeLessThan(auditOrder!)
  })

  it('АС2: без reason → ValidationError (400), ни facade, ни audit.write не вызываются', async () => {
    const { useCase, liftInvoiceBlockMock, auditWriteMock, getRunCallCount } = buildHarness()

    await expect(useCase.execute({ invoiceId: 'invoice-1', rawBody: {}, actor: ACTOR, requestId: null })).rejects.toThrow(ValidationError)
    expect(getRunCallCount()).toBe(0)
    expect(liftInvoiceBlockMock).not.toHaveBeenCalled()
    expect(auditWriteMock).not.toHaveBeenCalled()
  })

  it('reason короче 10 символов → ValidationError', async () => {
    const { useCase } = buildHarness()

    await expect(useCase.execute({ invoiceId: 'invoice-1', rawBody: { reason: 'short' }, actor: ACTOR, requestId: null })).rejects.toThrow(
      ValidationError,
    )
  })

  it('инвойс не найден → NotFoundError, liftInvoiceBlock не вызывается', async () => {
    const { useCase, liftInvoiceBlockMock } = buildHarness({ invoice: null })

    await expect(
      useCase.execute({ invoiceId: 'missing', rawBody: { reason: 'invoice paid by bank transfer' }, actor: ACTOR, requestId: null }),
    ).rejects.toThrow(NotFoundError)
    expect(liftInvoiceBlockMock).not.toHaveBeenCalled()
  })

  it('audit.write() бросает ПОСЛЕ успешного liftInvoiceBlock → execute() отклоняется (АС3 — откат всей транзакции)', async () => {
    const { useCase, liftInvoiceBlockMock, auditWriteMock } = buildHarness({ auditWriteError: new Error('audit down') })

    await expect(
      useCase.execute({ invoiceId: 'invoice-1', rawBody: { reason: 'invoice paid by bank transfer' }, actor: ACTOR, requestId: null }),
    ).rejects.toThrow('audit down')
    expect(liftInvoiceBlockMock).toHaveBeenCalledTimes(1)
    expect(auditWriteMock).toHaveBeenCalledTimes(1)
  })
})
