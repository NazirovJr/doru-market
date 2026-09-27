import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError } from '@dorutj/contracts'
import { CreatePharmacyApiKeyUseCase } from './create-pharmacy-api-key.use-case.js'
import type { OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import type { CreatedPharmacyApiKeyView, InventoryFacadePort } from '../ports/inventory-facade.port.js'

const CREATED: CreatedPharmacyApiKeyView = { id: 'key-1', secret: 'abc', keyPrefix: 'abc12345', createdAt: new Date('2026-01-01') }
const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'

function fakeFacades(chainId: string | null): {
  onboardingFacade: OnboardingFacadePort
  inventoryFacade: InventoryFacadePort
  getPharmacyChainId: ReturnType<typeof vi.fn>
  createPharmacyApiKey: ReturnType<typeof vi.fn>
} {
  const getPharmacyChainId = vi.fn().mockResolvedValue(chainId)
  const createPharmacyApiKey = vi.fn().mockResolvedValue(CREATED)
  return {
    onboardingFacade: { findPharmacyAccountsAny: vi.fn(), getPharmacyChainId },
    inventoryFacade: { getInventorySummary: vi.fn(), createPharmacyApiKey, listPharmacyApiKeys: vi.fn(), revokePharmacyApiKey: vi.fn() },
    getPharmacyChainId,
    createPharmacyApiKey,
  }
}

describe('CreatePharmacyApiKeyUseCase (admin, DTJ-365)', () => {
  it('pharmacy_admin, своя аптека — создаёт ключ', async () => {
    const { onboardingFacade, inventoryFacade, createPharmacyApiKey } = fakeFacades(OWN_CHAIN_ID)
    const useCase = new CreatePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade)

    const result = await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1' })

    expect(result).toBe(CREATED)
    expect(createPharmacyApiKey).toHaveBeenCalledWith('pharmacy-1')
  })

  it('pharmacy_admin, чужая сеть (DTJ-365 AC4) — CrossTenantAccessDeniedError, facade НЕ вызывается', async () => {
    const { onboardingFacade, inventoryFacade, createPharmacyApiKey } = fakeFacades(OTHER_CHAIN_ID)
    const useCase = new CreatePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade)

    await expect(
      useCase.execute({ actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1' }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(createPharmacyApiKey).not.toHaveBeenCalled()
  })

  it('super_admin — владение не проверяется', async () => {
    const { onboardingFacade, inventoryFacade, getPharmacyChainId, createPharmacyApiKey } = fakeFacades(OTHER_CHAIN_ID)
    const useCase = new CreatePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade)

    const result = await useCase.execute({ actor: { role: 'super_admin', chainId: null }, pharmacyId: 'pharmacy-1' })

    expect(result).toBe(CREATED)
    expect(getPharmacyChainId).not.toHaveBeenCalled()
    expect(createPharmacyApiKey).toHaveBeenCalledWith('pharmacy-1')
  })
})
