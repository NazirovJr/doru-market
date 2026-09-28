import { describe, expect, it, vi } from 'vitest'
import type { FinancePage, PayoutScheduleEntryView, PaymentsFacadePort } from '../ports/payments-facade.port.js'
import { ListPayoutScheduleUseCase } from './list-payout-schedule.use-case.js'

const PAGE: FinancePage<PayoutScheduleEntryView> = {
  items: [
    {
      orderId: 'order-1',
      orderNumber: 'DTJ-260904-00001',
      pharmacyId: 'pharmacy-1',
      grossAmountDiram: 20_000,
      commissionDiram: 1_600,
      netAmountDiram: 18_400,
      status: 'due',
      dueAt: new Date('2026-09-05T00:00:00.000Z'),
      paidAt: null,
    },
  ],
  nextCursor: { v: '2026-09-04T00:00:00.000Z', id: 'payout-1' },
  hasMore: true,
}

function buildHarness() {
  const findPayoutScheduleMock = vi.fn<PaymentsFacadePort['findPayoutSchedule']>().mockResolvedValue(PAGE)
  const facade: PaymentsFacadePort = {
    findEscrowLedgerEntries: vi.fn(),
    findPayoutSchedule: findPayoutScheduleMock,
    findPayoutScheduleByOrder: vi.fn(),
    listBillingInvoices: vi.fn(),
    getBillingInvoiceById: vi.fn(),
    markInvoicePaid: vi.fn(),
  }
  const useCase = new ListPayoutScheduleUseCase(facade)
  return { useCase, findPayoutScheduleMock }
}

describe('ListPayoutScheduleUseCase (DTJ-357)', () => {
  it('передаёт status/pharmacyId/limit/cursor в PaymentsFacadePort.findPayoutSchedule', async () => {
    const { useCase, findPayoutScheduleMock } = buildHarness()
    const cursor = { v: '2026-09-03T00:00:00.000Z', id: 'payout-0' }

    await useCase.execute({ status: 'due', pharmacyId: 'pharmacy-1', limit: 20, cursor })

    expect(findPayoutScheduleMock).toHaveBeenCalledWith({ status: 'due', pharmacyId: 'pharmacy-1' }, { limit: 20, cursor })
  })

  it('оба фильтра опциональны — undefined, если не заданы', async () => {
    const { useCase, findPayoutScheduleMock } = buildHarness()

    await useCase.execute({ limit: 20, cursor: null })

    expect(findPayoutScheduleMock).toHaveBeenCalledWith({ status: undefined, pharmacyId: undefined }, { limit: 20, cursor: null })
  })

  it('пробрасывает страницу без изменений', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ limit: 20, cursor: null })

    expect(result).toEqual(PAGE)
  })
})
