import { describe, expect, it, vi } from 'vitest'
import type { OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import type { BillingInvoiceView, FinancePage, PaymentsFacadePort } from '../ports/payments-facade.port.js'
import { ListBillingInvoicesUseCase } from './list-billing-invoices.use-case.js'

const INVOICE_A: BillingInvoiceView = {
  id: 'invoice-a',
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
const INVOICE_B: BillingInvoiceView = { ...INVOICE_A, id: 'invoice-b', chainId: 'chain-2' }

function buildHarness(page: FinancePage<BillingInvoiceView>, chainNames: ReadonlyMap<string, string>) {
  const listBillingInvoicesMock = vi.fn<PaymentsFacadePort['listBillingInvoices']>().mockResolvedValue(page)
  const paymentsFacade: PaymentsFacadePort = {
    findEscrowLedgerEntries: vi.fn(),
    findPayoutSchedule: vi.fn(),
    findPayoutScheduleByOrder: vi.fn(),
    listBillingInvoices: listBillingInvoicesMock,
    getBillingInvoiceById: vi.fn(),
    markInvoicePaid: vi.fn(),
    listCommissionRates: vi.fn(),
    upsertCommissionRate: vi.fn(),
  }
  const findChainNamesMock = vi.fn<OnboardingFacadePort['findChainNames']>().mockResolvedValue(chainNames)
  const onboardingFacade: OnboardingFacadePort = {
    findPharmacyAccountsAny: vi.fn(),
    getPharmacyChainId: vi.fn(),
    getScheduleAndZone: vi.fn(),
    updateSchedule: vi.fn(),
    updateDeliveryZone: vi.fn(),
    liftInvoiceBlock: vi.fn(),
    findChainNames: findChainNamesMock,
  }
  const useCase = new ListBillingInvoicesUseCase(paymentsFacade, onboardingFacade)
  return { useCase, listBillingInvoicesMock, findChainNamesMock }
}

describe('ListBillingInvoicesUseCase (DTJ-359)', () => {
  it('прокидывает filter[chainId]/filter[type]/filter[status] в PaymentsFacadePort, догружает chainName батчем по уникальным chainId', async () => {
    const page: FinancePage<BillingInvoiceView> = { items: [INVOICE_A, INVOICE_B], nextCursor: null, hasMore: false }
    const chainNames = new Map([
      ['chain-1', 'Сеть Салом'],
      ['chain-2', 'Сеть Фарм'],
    ])
    const { useCase, listBillingInvoicesMock, findChainNamesMock } = buildHarness(page, chainNames)

    const result = await useCase.execute({ chainId: 'chain-1', invoiceType: 'cash_courier_commission', status: 'issued', limit: 50, cursor: null })

    expect(listBillingInvoicesMock).toHaveBeenCalledWith(
      { chainId: 'chain-1', invoiceType: 'cash_courier_commission', status: 'issued' },
      { limit: 50, cursor: null },
    )
    expect(findChainNamesMock).toHaveBeenCalledWith(['chain-1', 'chain-2'])
    expect(result.items).toEqual([
      { ...INVOICE_A, chainName: 'Сеть Салом' },
      { ...INVOICE_B, chainName: 'Сеть Фарм' },
    ])
  })

  it('несуществующая сеть в chainNames → chainName null, не бросает', async () => {
    const page: FinancePage<BillingInvoiceView> = { items: [INVOICE_A], nextCursor: null, hasMore: false }
    const { useCase } = buildHarness(page, new Map())

    const result = await useCase.execute({ limit: 50, cursor: null })

    expect(result.items[0]?.chainName).toBeNull()
  })
})
