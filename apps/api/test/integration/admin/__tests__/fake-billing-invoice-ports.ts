// Фейковые порты для billing-invoices.controller.e2e.spec.ts — тот же приём, что fake-payments-facade-port.ts.
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import type { UnitOfWorkPort } from '@/modules/auth/index.js'
import type { BillingInvoiceView, MarkInvoicePaidOutcome, PaymentsFacadePort } from '@/modules/admin/application/ports/payments-facade.port.js'
import type { OnboardingFacadePort } from '@/modules/admin/application/ports/onboarding-facade.port.js'

export interface FakeInvoiceSeed {
  readonly id: string
  readonly chainId: string
  readonly status: string
}

export interface FakeBillingInvoicePorts {
  readonly paymentsFacade: PaymentsFacadePort
  readonly onboardingFacade: OnboardingFacadePort
  readonly auditLog: AuditLogPort
  readonly unitOfWork: UnitOfWorkPort
  readonly auditEntries: Parameters<AuditLogPort['write']>[0][]
  readonly liftInvoiceBlockCalls: { readonly chainId: string; readonly actorUserId: string }[]
}

function toView(seed: FakeInvoiceSeed & { paidAt?: Date | null }): BillingInvoiceView {
  return {
    id: seed.id,
    chainId: seed.chainId,
    invoiceType: 'cash_courier_commission',
    status: seed.status,
    periodStart: new Date('2026-08-01T00:00:00.000Z'),
    periodEnd: new Date('2026-08-31T00:00:00.000Z'),
    subtotalDiram: 10_000,
    vatDiram: 1_500,
    totalDiram: 11_500,
    issuedAt: new Date('2026-09-01T00:00:00.000Z'),
    dueAt: new Date('2026-09-10T00:00:00.000Z'),
    paidAt: seed.paidAt ?? null,
  }
}

const PAYABLE_STATUSES = new Set(['issued', 'overdue'])

export function createFakeBillingInvoicePorts(seed: readonly FakeInvoiceSeed[]): FakeBillingInvoicePorts {
  const invoices = new Map<string, BillingInvoiceView>(seed.map((s) => [s.id, toView(s)]))
  const auditEntries: Parameters<AuditLogPort['write']>[0][] = []
  const liftInvoiceBlockCalls: { readonly chainId: string; readonly actorUserId: string }[] = []

  const paymentsFacade: PaymentsFacadePort = {
    findEscrowLedgerEntries: () => Promise.resolve([]),
    findPayoutSchedule: () => Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
    findPayoutScheduleByOrder: () => Promise.resolve(null),
    listBillingInvoices: (filter) => {
      let items = [...invoices.values()]
      if (filter.chainId !== undefined) items = items.filter((i) => i.chainId === filter.chainId)
      if (filter.status !== undefined) items = items.filter((i) => i.status === filter.status)
      if (filter.invoiceType !== undefined) items = items.filter((i) => i.invoiceType === filter.invoiceType)
      return Promise.resolve({ items, nextCursor: null, hasMore: false })
    },
    getBillingInvoiceById: (invoiceId) => Promise.resolve(invoices.get(invoiceId) ?? null),
    markInvoicePaid: (invoiceId): Promise<MarkInvoicePaidOutcome> => {
      const invoice = invoices.get(invoiceId)
      if (invoice === undefined) return Promise.resolve('not_found')
      if (invoice.status === 'paid') return Promise.resolve('already_paid')
      if (!PAYABLE_STATUSES.has(invoice.status)) return Promise.resolve('invalid_status')
      invoices.set(invoiceId, { ...invoice, status: 'paid', paidAt: new Date('2026-09-15T00:00:00.000Z') })
      return Promise.resolve('paid')
    },
    listCommissionRates: () => Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
    upsertCommissionRate: () => Promise.reject(new Error('not under test')),
    refundFull: () => Promise.reject(new Error('not under test')),
    adminPaymentOverride: () => Promise.reject(new Error('not under test')),
  }

  const onboardingFacade: OnboardingFacadePort = {
    findPharmacyAccountsAny: () => Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
    getPharmacyChainId: () => Promise.resolve(null),
    getScheduleAndZone: () => Promise.resolve(null),
    updateSchedule: () => Promise.reject(new Error('not used in this harness')),
    updateDeliveryZone: () => Promise.reject(new Error('not used in this harness')),
    liftInvoiceBlock: (chainId, actor) => {
      liftInvoiceBlockCalls.push({ chainId, actorUserId: actor.id })
      return Promise.resolve()
    },
    findChainNames: (chainIds) => Promise.resolve(new Map(chainIds.map((id) => [id, `Chain ${id}`]))),
  }

  const auditLog: AuditLogPort = {
    write: (entry) => {
      auditEntries.push(entry)
      return Promise.resolve()
    },
  }

  // Фейковый UnitOfWork: callback выполняется напрямую (in-memory состояние выше не требует реальной транзакции).
  const unitOfWork: UnitOfWorkPort = { run: (cb) => cb(undefined) }

  return { paymentsFacade, onboardingFacade, auditLog, unitOfWork, auditEntries, liftInvoiceBlockCalls }
}
