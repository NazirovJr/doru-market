import { describe, expect, it, vi } from 'vitest'
import type { CommissionRateView, FinancePage, PaymentsFacadePort } from '../ports/payments-facade.port.js'
import { ListCommissionRatesUseCase } from './list-commission-rates.use-case.js'

const PAGE: FinancePage<CommissionRateView> = {
  items: [
    {
      id: 'rate-1',
      tenantId: null,
      chainId: null,
      category: 'rx',
      rateBps: 500,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      createdBy: 'user-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ],
  nextCursor: { v: '2026-01-01T00:00:00.000Z', id: 'rate-1' },
  hasMore: true,
}

function buildHarness() {
  const listCommissionRatesMock = vi.fn<PaymentsFacadePort['listCommissionRates']>().mockResolvedValue(PAGE)
  const facade: PaymentsFacadePort = {
    findEscrowLedgerEntries: vi.fn(),
    findPayoutSchedule: vi.fn(),
    findPayoutScheduleByOrder: vi.fn(),
    listCommissionRates: listCommissionRatesMock,
    upsertCommissionRate: vi.fn(),
    listBillingInvoices: vi.fn(),
    getBillingInvoiceById: vi.fn(),
    markInvoicePaid: vi.fn(),
  }
  const useCase = new ListCommissionRatesUseCase(facade)
  return { useCase, listCommissionRatesMock }
}

describe('ListCommissionRatesUseCase (DTJ-358)', () => {
  it('передаёт tenantId/chainId/category/limit/cursor в PaymentsFacadePort.listCommissionRates', async () => {
    const { useCase, listCommissionRatesMock } = buildHarness()
    const cursor = { v: '2025-12-31T00:00:00.000Z', id: 'rate-0' }

    await useCase.execute({ tenantId: 'tenant-1', chainId: 'chain-1', category: 'otc', limit: 20, cursor })

    expect(listCommissionRatesMock).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', chainId: 'chain-1', category: 'otc' },
      { limit: 20, cursor },
    )
  })

  it('все фильтры опциональны — undefined, если не заданы', async () => {
    const { useCase, listCommissionRatesMock } = buildHarness()

    await useCase.execute({ limit: 20, cursor: null })

    expect(listCommissionRatesMock).toHaveBeenCalledWith({ tenantId: undefined, chainId: undefined, category: undefined }, { limit: 20, cursor: null })
  })

  it('пробрасывает страницу без изменений', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ limit: 20, cursor: null })

    expect(result).toEqual(PAGE)
  })
})
