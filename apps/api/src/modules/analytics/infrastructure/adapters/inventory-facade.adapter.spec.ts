import { describe, expect, it, vi } from 'vitest'
import { InventoryFacadeAdapter } from './inventory-facade.adapter.js'
import type { OnboardingFacade } from '@/modules/onboarding/index.js'
import type { InventoryFacade } from '@/modules/inventory/index.js'

function fakeOnboarding(activeIds: readonly string[]): OnboardingFacade {
  return { listActivePharmacyIds: vi.fn().mockResolvedValue(activeIds) } as unknown as OnboardingFacade
}

function fakeInventory(sendingIds: ReadonlySet<string>): InventoryFacade {
  return { findPharmacyIdsWithRecentSyncActivity: vi.fn().mockResolvedValue(sendingIds) } as unknown as InventoryFacade
}

describe('InventoryFacadeAdapter.getActivePharmaciesSendingDataRate (DTJ-382, TC-ADM-030)', () => {
  it('3 из 8 активных аптек прислали данные за 7 дней → 0.375', async () => {
    const activeIds = Array.from({ length: 8 }, (_, i) => `pharmacy-${String(i)}`)
    const sendingIds = new Set(['pharmacy-0', 'pharmacy-1', 'pharmacy-2'])
    const adapter = new InventoryFacadeAdapter(fakeOnboarding(activeIds), fakeInventory(sendingIds))

    await expect(adapter.getActivePharmaciesSendingDataRate('tenant-1')).resolves.toBeCloseTo(0.375)
  })

  it('нет активных аптек тенанта → 0, не деление на 0/NaN', async () => {
    const adapter = new InventoryFacadeAdapter(fakeOnboarding([]), fakeInventory(new Set()))

    await expect(adapter.getActivePharmaciesSendingDataRate('tenant-1')).resolves.toBe(0)
  })
})
