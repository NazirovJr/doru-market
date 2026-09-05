import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@dorutj/contracts'
import type { PlatformBillingInvoiceRepository } from '@/modules/payments/application/ports/platform-billing-invoice-repository.port.js'
import type { PharmacyChainLookupPort } from '@/modules/payments/application/ports/pharmacy-chain-lookup.port.js'
import { GetBillingInvoicesQuery } from './get-billing-invoices.query.js'

const SUPER_ADMIN = { role: 'super_admin' as const, chainId: null }

/** Возвращает порт И отдельную переменную `findByChain` (не `repository.findByChain`) — @typescript-eslint/unbound-method. */
function fakeInvoiceRepository(): { repository: PlatformBillingInvoiceRepository; findByChain: ReturnType<typeof vi.fn> } {
  const findByChain = vi.fn().mockResolvedValue({
    items: [
      {
        id: 'invoice-1',
        invoiceType: 'cash_courier_commission',
        status: 'issued',
        periodStart: new Date('2026-08-31T19:00:00.000Z'),
        periodEnd: new Date('2026-09-07T19:00:00.000Z'),
        subtotalDiram: 10_000n,
        vatDiram: 1_400n,
        totalDiram: 11_400n,
        issuedAt: new Date('2026-09-06T18:50:00.000Z'),
        dueAt: new Date('2026-09-13T18:50:00.000Z'),
        paidAt: null,
      },
    ],
    nextCursor: null,
    hasMore: false,
  })
  const repository: PlatformBillingInvoiceRepository = {
    findDraftForPeriod: vi.fn(),
    upsertDraft: vi.fn(),
    issue: vi.fn(),
    findByChain,
  }
  return { repository, findByChain }
}

function fakeChainLookup(chainId: string | null): PharmacyChainLookupPort {
  return { findChainId: vi.fn().mockResolvedValue(chainId) }
}

describe('GetBillingInvoicesQuery (DTJ-252, п.5)', () => {
  it('super_admin: резолвит chainId аптеки, делегирует findByChain, bigint → number на границе DTO', async () => {
    const { repository, findByChain } = fakeInvoiceRepository()
    const query = new GetBillingInvoicesQuery(repository, fakeChainLookup('chain-a'))

    const result = await query.execute({ pharmacyId: 'pharmacy-1', actor: SUPER_ADMIN, limit: 20, cursor: null })

    expect(findByChain).toHaveBeenCalledWith({ chainId: 'chain-a', limit: 20, cursor: null })
    expect(result.items[0]).toMatchObject({ id: 'invoice-1', subtotalDiram: 10_000, vatDiram: 1_400, totalDiram: 11_400 })
    expect(result.hasMore).toBe(false)
  })

  it('аптека без сети/несуществующая — пустой список, а не ошибка (super_admin)', async () => {
    const { repository, findByChain } = fakeInvoiceRepository()
    const query = new GetBillingInvoicesQuery(repository, fakeChainLookup(null))

    const result = await query.execute({ pharmacyId: 'missing', actor: SUPER_ADMIN, limit: 20, cursor: null })

    expect(result).toEqual({ items: [], nextCursor: null, hasMore: false })
    expect(findByChain).not.toHaveBeenCalled()
  })

  it('pharmacy_admin чужой сети — 403, репозиторий НЕ читается', async () => {
    const { repository, findByChain } = fakeInvoiceRepository()
    const query = new GetBillingInvoicesQuery(repository, fakeChainLookup('chain-a'))

    await expect(
      query.execute({ pharmacyId: 'pharmacy-1', actor: { role: 'pharmacy_admin', chainId: 'chain-b' }, limit: 20, cursor: null }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(findByChain).not.toHaveBeenCalled()
  })

  it('pharmacist — 403 (билинг сети не read-only отдельной аптеке)', async () => {
    const { repository } = fakeInvoiceRepository()
    const query = new GetBillingInvoicesQuery(repository, fakeChainLookup('chain-a'))

    await expect(
      query.execute({ pharmacyId: 'pharmacy-1', actor: { role: 'pharmacist', chainId: null }, limit: 20, cursor: null }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
