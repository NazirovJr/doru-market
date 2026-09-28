import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import type { CommissionRateView, PaymentsFacadePort } from '../ports/payments-facade.port.js'
import { UpsertCommissionRateUseCase } from './upsert-commission-rate.use-case.js'

const ACTOR = { userId: 'user-1' }

const CREATED_RATE: CommissionRateView = {
  id: 'rate-1',
  tenantId: null,
  chainId: null,
  category: 'rx',
  rateBps: 600,
  effectiveFrom: '2026-10-01',
  effectiveTo: null,
  createdBy: ACTOR.userId,
  createdAt: new Date('2026-09-27T00:00:00.000Z'),
}

// throwIfCalled на всех методах кроме upsertCommissionRate — падение теста при их вызове доказывает АС3 (upsert не трогает order_items).
function buildHarness(upsertCommissionRateMock: PaymentsFacadePort['upsertCommissionRate']) {
  function throwIfCalled(name: string): () => never {
    return () => {
      throw new Error(`unexpected call to PaymentsFacadePort.${name} — upsert must only touch commission_rate`)
    }
  }
  const facade: PaymentsFacadePort = {
    findEscrowLedgerEntries: throwIfCalled('findEscrowLedgerEntries'),
    findPayoutSchedule: throwIfCalled('findPayoutSchedule'),
    findPayoutScheduleByOrder: throwIfCalled('findPayoutScheduleByOrder'),
    listCommissionRates: throwIfCalled('listCommissionRates'),
    upsertCommissionRate: upsertCommissionRateMock,
    listBillingInvoices: throwIfCalled('listBillingInvoices'),
    getBillingInvoiceById: throwIfCalled('getBillingInvoiceById'),
    markInvoicePaid: throwIfCalled('markInvoicePaid'),
  }
  return new UpsertCommissionRateUseCase(facade)
}

describe('UpsertCommissionRateUseCase (DTJ-358)', () => {
  it('rateBps вне 0..10000 → ValidationError, ДО вызова PaymentsFacadePort', async () => {
    const upsertMock = vi.fn()
    const useCase = buildHarness(upsertMock)

    await expect(
      useCase.execute({ rawBody: { category: 'rx', rateBps: 15_000, effectiveFrom: '2026-10-01' }, actor: ACTOR }),
    ).rejects.toThrow(ValidationError)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('невалидная category ("parapharmacy", реальное значение — "parapharma") → ValidationError', async () => {
    const useCase = buildHarness(vi.fn())

    await expect(
      useCase.execute({ rawBody: { category: 'parapharmacy', rateBps: 500, effectiveFrom: '2026-10-01' }, actor: ACTOR }),
    ).rejects.toThrow(ValidationError)
  })

  it('effectiveTo <= effectiveFrom → ValidationError', async () => {
    const useCase = buildHarness(vi.fn())

    await expect(
      useCase.execute({
        rawBody: { category: 'rx', rateBps: 500, effectiveFrom: '2026-10-01', effectiveTo: '2026-10-01' },
        actor: ACTOR,
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('валидное тело → делегирует PaymentsFacadePort.upsertCommissionRate с actorUserId, tenantId/chainId=null по умолчанию', async () => {
    const upsertMock = vi.fn<PaymentsFacadePort['upsertCommissionRate']>().mockResolvedValue(CREATED_RATE)
    const useCase = buildHarness(upsertMock)

    const result = await useCase.execute({ rawBody: { category: 'rx', rateBps: 600, effectiveFrom: '2026-10-01' }, actor: ACTOR })

    expect(upsertMock).toHaveBeenCalledWith({
      id: undefined,
      tenantId: null,
      chainId: null,
      category: 'rx',
      rateBps: 600,
      effectiveFrom: '2026-10-01',
      effectiveTo: null,
      actorUserId: ACTOR.userId,
    })
    expect(result).toEqual(CREATED_RATE)
  })

  it('PATCH (id задан) — id пробрасывается в команду', async () => {
    const upsertMock = vi.fn<PaymentsFacadePort['upsertCommissionRate']>().mockResolvedValue(CREATED_RATE)
    const useCase = buildHarness(upsertMock)

    await useCase.execute({ id: 'rate-1', rawBody: { category: 'rx', rateBps: 600, effectiveFrom: '2026-10-01' }, actor: ACTOR })

    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'rate-1' }))
  })

  it('АС3 — upsert НЕ трогает order_items: единственный вызванный метод факада — upsertCommissionRate', async () => {
    const upsertMock = vi.fn<PaymentsFacadePort['upsertCommissionRate']>().mockResolvedValue(CREATED_RATE)
    const useCase = buildHarness(upsertMock)

    await useCase.execute({ rawBody: { category: 'rx', rateBps: 600, effectiveFrom: '2026-10-01' }, actor: ACTOR })

    expect(upsertMock).toHaveBeenCalledTimes(1)
  })
})
