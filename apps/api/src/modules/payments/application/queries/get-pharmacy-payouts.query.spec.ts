import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@dorutj/contracts'
import type { PayoutScheduleRepository } from '@/modules/payments/application/ports/payout-schedule-repository.port.js'
import type { PharmacyChainLookupPort } from '@/modules/payments/application/ports/pharmacy-chain-lookup.port.js'
import { GetPharmacyPayoutsQuery } from './get-pharmacy-payouts.query.js'

const SUPER_ADMIN = { role: 'super_admin' as const, chainId: null, pharmacyId: null }

/** Возвращает порт И отдельную переменную `findByPharmacy` (не `repository.findByPharmacy`) — @typescript-eslint/unbound-method. */
function fakePayoutRepository(): { repository: PayoutScheduleRepository; findByPharmacy: ReturnType<typeof vi.fn> } {
  const findByPharmacy = vi.fn().mockResolvedValue({
    items: [
      {
        orderId: 'order-1',
        orderNumber: 'DTJ-260904-00001',
        grossAmountDiram: 20_000n,
        commissionDiram: 1_600n,
        netAmountDiram: 18_400n,
        status: 'due',
        dueAt: new Date('2026-09-05T00:00:00.000Z'),
        paidAt: null,
      },
    ],
    nextCursor: { v: '2026-09-04T00:00:00.000Z', id: 'payout-1' },
    hasMore: true,
  })
  const repository: PayoutScheduleRepository = {
    reverseIfExists: vi.fn(),
    insertPending: vi.fn(),
    holdIfPending: vi.fn(),
    findByPharmacy,
    findAllByPharmacy: vi.fn(),
  }
  return { repository, findByPharmacy }
}

function fakeChainLookup(chainId: string | null = null): PharmacyChainLookupPort {
  return { findChainId: vi.fn().mockResolvedValue(chainId) }
}

describe('GetPharmacyPayoutsQuery (DTJ-252)', () => {
  it('super_admin: делегирует findByPharmacy, bigint → number на границе DTO', async () => {
    const { repository, findByPharmacy } = fakePayoutRepository()
    const query = new GetPharmacyPayoutsQuery(repository, fakeChainLookup())

    const result = await query.execute({ pharmacyId: 'pharmacy-1', actor: SUPER_ADMIN, limit: 20, cursor: null })

    expect(findByPharmacy).toHaveBeenCalledWith({
      pharmacyId: 'pharmacy-1',
      statuses: undefined,
      limit: 20,
      cursor: null,
    })
    expect(result.items).toEqual([
      {
        orderId: 'order-1',
        orderNumber: 'DTJ-260904-00001',
        grossAmountDiram: 20_000,
        commissionDiram: 1_600,
        netAmountDiram: 18_400,
        status: 'due',
        dueAt: new Date('2026-09-05T00:00:00.000Z'),
        paidAt: null,
      },
    ])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toEqual({ v: '2026-09-04T00:00:00.000Z', id: 'payout-1' })
  })

  it('пробрасывает filter[status][in] как statuses в репозиторий', async () => {
    const { repository, findByPharmacy } = fakePayoutRepository()
    const query = new GetPharmacyPayoutsQuery(repository, fakeChainLookup())

    await query.execute({ pharmacyId: 'pharmacy-1', actor: SUPER_ADMIN, statuses: ['due', 'paid'], limit: 20, cursor: null })

    expect(findByPharmacy).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['due', 'paid'] }))
  })

  it('pharmacy_admin чужой сети — 403, репозиторий НЕ вызывается', async () => {
    const { repository, findByPharmacy } = fakePayoutRepository()
    const query = new GetPharmacyPayoutsQuery(repository, fakeChainLookup('chain-a'))

    await expect(
      query.execute({
        pharmacyId: 'pharmacy-1',
        actor: { role: 'pharmacy_admin', chainId: 'chain-b', pharmacyId: null },
        limit: 20,
        cursor: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(findByPharmacy).not.toHaveBeenCalled()
  })

  it('pharmacist чужой аптеки — 403 (АС5), репозиторий НЕ вызывается', async () => {
    const { repository, findByPharmacy } = fakePayoutRepository()
    const query = new GetPharmacyPayoutsQuery(repository, fakeChainLookup())

    await expect(
      query.execute({
        pharmacyId: 'pharmacy-2',
        actor: { role: 'pharmacist', chainId: null, pharmacyId: 'pharmacy-1' },
        limit: 20,
        cursor: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(findByPharmacy).not.toHaveBeenCalled()
  })
})
