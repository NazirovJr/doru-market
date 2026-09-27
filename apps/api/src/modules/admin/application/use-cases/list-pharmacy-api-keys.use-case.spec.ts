import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError } from '@dorutj/contracts'
import { ListPharmacyApiKeysUseCase } from './list-pharmacy-api-keys.use-case.js'
import type { OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import type { InventoryFacadePort, PharmacyApiKeySummaryView } from '../ports/inventory-facade.port.js'

const SUMMARIES: readonly PharmacyApiKeySummaryView[] = [
  { id: 'key-1', keyPrefix: 'abc12345', isActive: true, requireMtls: false, createdAt: new Date('2026-01-01'), lastUsedAt: null, revokedAt: null },
]
const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'
const ACTOR_USER_ID = 'admin-1'

function fakeFacades(chainId: string | null): {
  onboardingFacade: OnboardingFacadePort
  inventoryFacade: InventoryFacadePort
  listPharmacyApiKeys: ReturnType<typeof vi.fn>
} {
  const getPharmacyChainId = vi.fn().mockResolvedValue(chainId)
  const listPharmacyApiKeys = vi.fn().mockResolvedValue(SUMMARIES)
  return {
    onboardingFacade: { findPharmacyAccountsAny: vi.fn(), getPharmacyChainId },
    inventoryFacade: {
      getInventorySummary: vi.fn(),
      createPharmacyApiKey: vi.fn(),
      listPharmacyApiKeys,
      revokePharmacyApiKey: vi.fn(),
      rotatePharmacyApiKey: vi.fn(),
      setPharmacyApiKeyMtls: vi.fn(),
    },
    listPharmacyApiKeys,
  }
}

describe('ListPharmacyApiKeysUseCase (admin, DTJ-365)', () => {
  it('pharmacy_admin, своя аптека — список ключей БЕЗ секрета', async () => {
    const { onboardingFacade, inventoryFacade, listPharmacyApiKeys } = fakeFacades(OWN_CHAIN_ID)
    const useCase = new ListPharmacyApiKeysUseCase(onboardingFacade, inventoryFacade)

    const result = await useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1' })

    expect(result).toBe(SUMMARIES)
    expect(listPharmacyApiKeys).toHaveBeenCalledWith('pharmacy-1')
  })

  it('pharmacy_admin, чужая сеть — CrossTenantAccessDeniedError, facade НЕ вызывается', async () => {
    const { onboardingFacade, inventoryFacade, listPharmacyApiKeys } = fakeFacades(OTHER_CHAIN_ID)
    const useCase = new ListPharmacyApiKeysUseCase(onboardingFacade, inventoryFacade)

    await expect(
      useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1' }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(listPharmacyApiKeys).not.toHaveBeenCalled()
  })
})
