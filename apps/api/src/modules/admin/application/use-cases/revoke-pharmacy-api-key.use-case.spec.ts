import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError, NotFoundError } from '@dorutj/contracts'
import { RevokePharmacyApiKeyUseCase } from './revoke-pharmacy-api-key.use-case.js'
import type { OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import type { InventoryFacadePort } from '../ports/inventory-facade.port.js'

const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'

function fakeFacades(
  chainId: string | null,
  revoked: boolean,
): { onboardingFacade: OnboardingFacadePort; inventoryFacade: InventoryFacadePort; revokePharmacyApiKey: ReturnType<typeof vi.fn> } {
  const getPharmacyChainId = vi.fn().mockResolvedValue(chainId)
  const revokePharmacyApiKey = vi.fn().mockResolvedValue(revoked)
  return {
    onboardingFacade: { findPharmacyAccountsAny: vi.fn(), getPharmacyChainId },
    inventoryFacade: { getInventorySummary: vi.fn(), createPharmacyApiKey: vi.fn(), listPharmacyApiKeys: vi.fn(), revokePharmacyApiKey },
    revokePharmacyApiKey,
  }
}

describe('RevokePharmacyApiKeyUseCase (admin, DTJ-365)', () => {
  it('pharmacy_admin, своя аптека — отзывает', async () => {
    const { onboardingFacade, inventoryFacade, revokePharmacyApiKey } = fakeFacades(OWN_CHAIN_ID, true)
    const useCase = new RevokePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade)

    await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', keyId: 'key-1', reason: 'r' })

    expect(revokePharmacyApiKey).toHaveBeenCalledWith('pharmacy-1', 'key-1', 'r')
  })

  it('pharmacy_admin, чужая сеть — CrossTenantAccessDeniedError, facade НЕ вызывается', async () => {
    const { onboardingFacade, inventoryFacade, revokePharmacyApiKey } = fakeFacades(OTHER_CHAIN_ID, true)
    const useCase = new RevokePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade)

    await expect(
      useCase.execute({ actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', keyId: 'key-1', reason: 'r' }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(revokePharmacyApiKey).not.toHaveBeenCalled()
  })

  it('facade вернул false (не найден/уже отозван) — NotFoundError', async () => {
    const { onboardingFacade, inventoryFacade } = fakeFacades(OWN_CHAIN_ID, false)
    const useCase = new RevokePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade)

    await expect(
      useCase.execute({ actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', keyId: 'key-1', reason: 'r' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
