import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@dorutj/contracts'
import type { PharmacyChainLookupPort } from '@/modules/payments/application/ports/pharmacy-chain-lookup.port.js'
import { assertChainReportAccess, assertPharmacyReportAccess } from './pharmacy-report-access.util.js'

function fakeChainLookup(chainId: string | null): PharmacyChainLookupPort {
  return { findChainId: vi.fn().mockResolvedValue(chainId) }
}

describe('assertPharmacyReportAccess (DTJ-252, АС5)', () => {
  it('super_admin — всегда допущен, chainLookup не вызывается', async () => {
    // Отдельная переменная (не `chainLookup.findChainId`) — @typescript-eslint/unbound-method.
    const findChainId = vi.fn().mockResolvedValue(null)
    const chainLookup: PharmacyChainLookupPort = { findChainId }
    await expect(
      assertPharmacyReportAccess(chainLookup, 'pharmacy-1', { role: 'super_admin', chainId: null, pharmacyId: null }),
    ).resolves.toBeUndefined()
    expect(findChainId).not.toHaveBeenCalled()
  })

  it('pharmacy_admin своей сети — допущен', async () => {
    const chainLookup = fakeChainLookup('chain-a')
    await expect(
      assertPharmacyReportAccess(chainLookup, 'pharmacy-1', { role: 'pharmacy_admin', chainId: 'chain-a', pharmacyId: null }),
    ).resolves.toBeUndefined()
  })

  it('pharmacy_admin ЧУЖОЙ сети — 403 ForbiddenError', async () => {
    const chainLookup = fakeChainLookup('chain-a')
    await expect(
      assertPharmacyReportAccess(chainLookup, 'pharmacy-1', { role: 'pharmacy_admin', chainId: 'chain-b', pharmacyId: null }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pharmacy_admin, аптека не существует (chainId=null) — 403, не подтверждает существование', async () => {
    const chainLookup = fakeChainLookup(null)
    await expect(
      assertPharmacyReportAccess(chainLookup, 'missing', { role: 'pharmacy_admin', chainId: 'chain-a', pharmacyId: null }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pharmacist своей аптеки (pharmacyId совпадает с :id) — допущен, chainLookup не вызывается', async () => {
    const findChainId = vi.fn().mockResolvedValue(null)
    const chainLookup: PharmacyChainLookupPort = { findChainId }
    await expect(
      assertPharmacyReportAccess(chainLookup, 'pharmacy-1', { role: 'pharmacist', chainId: null, pharmacyId: 'pharmacy-1' }),
    ).resolves.toBeUndefined()
    expect(findChainId).not.toHaveBeenCalled()
  })

  it('pharmacist ЧУЖОЙ аптеки той же сети (:id !== claims.pharmacyId) — 403, АС5 буквально', async () => {
    const chainLookup = fakeChainLookup('chain-a')
    await expect(
      assertPharmacyReportAccess(chainLookup, 'pharmacy-2', { role: 'pharmacist', chainId: null, pharmacyId: 'pharmacy-1' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('прочие роли (customer/courier/support_agent) — 403', async () => {
    const chainLookup = fakeChainLookup('chain-a')
    await expect(
      assertPharmacyReportAccess(chainLookup, 'pharmacy-1', { role: 'customer', chainId: null, pharmacyId: null }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('assertChainReportAccess (DTJ-252, п.5 — billing-invoices)', () => {
  it('super_admin — всегда допущен', async () => {
    const chainLookup = fakeChainLookup(null)
    await expect(assertChainReportAccess(chainLookup, 'pharmacy-1', { role: 'super_admin', chainId: null })).resolves.toBeUndefined()
  })

  it('pharmacy_admin своей сети — допущен', async () => {
    const chainLookup = fakeChainLookup('chain-a')
    await expect(assertChainReportAccess(chainLookup, 'pharmacy-1', { role: 'pharmacy_admin', chainId: 'chain-a' })).resolves.toBeUndefined()
  })

  it('pharmacy_admin чужой сети — 403', async () => {
    const chainLookup = fakeChainLookup('chain-a')
    await expect(assertChainReportAccess(chainLookup, 'pharmacy-1', { role: 'pharmacy_admin', chainId: 'chain-b' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('pharmacist — 403 (билинг сети НЕ read-only отдельной аптеке, в отличие от payouts)', async () => {
    const chainLookup = fakeChainLookup('chain-a')
    await expect(assertChainReportAccess(chainLookup, 'pharmacy-1', { role: 'pharmacist', chainId: null })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})
