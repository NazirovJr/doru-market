import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError, NotFoundError } from '@dorutj/contracts'
import { SetPharmacyApiKeyMtlsUseCase } from './set-pharmacy-api-key-mtls.use-case.js'
import type { OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import type { InventoryFacadePort, PharmacyApiKeySummaryView } from '../ports/inventory-facade.port.js'

const SUMMARY: PharmacyApiKeySummaryView = { id: 'key-1', keyPrefix: 'abc12345', isActive: true, requireMtls: true, createdAt: new Date('2026-01-01'), lastUsedAt: null, revokedAt: null }
const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'
const ACTOR_USER_ID = 'admin-1'

function fakeFacades(
  chainId: string | null,
  setResult: PharmacyApiKeySummaryView | null,
): { onboardingFacade: OnboardingFacadePort; inventoryFacade: InventoryFacadePort; setPharmacyApiKeyMtls: ReturnType<typeof vi.fn> } {
  const getPharmacyChainId = vi.fn().mockResolvedValue(chainId)
  const setPharmacyApiKeyMtls = vi.fn().mockResolvedValue(setResult)
  return {
    onboardingFacade: {
      findPharmacyAccountsAny: vi.fn(),
      getPharmacyChainId,
      getScheduleAndZone: vi.fn(),
      updateSchedule: vi.fn(),
      updateDeliveryZone: vi.fn(),
    },
    inventoryFacade: {
      getInventorySummary: vi.fn(),
      createPharmacyApiKey: vi.fn(),
      listPharmacyApiKeys: vi.fn(),
      revokePharmacyApiKey: vi.fn(),
      rotatePharmacyApiKey: vi.fn(),
      setPharmacyApiKeyMtls,
    },
    setPharmacyApiKeyMtls,
  }
}

describe('SetPharmacyApiKeyMtlsUseCase (admin, DTJ-365)', () => {
  it('pharmacy_admin, своя аптека — переключает requireMtls', async () => {
    const { onboardingFacade, inventoryFacade, setPharmacyApiKeyMtls } = fakeFacades(OWN_CHAIN_ID, SUMMARY)
    const useCase = new SetPharmacyApiKeyMtlsUseCase(onboardingFacade, inventoryFacade)

    const result = await useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', keyId: 'key-1', requireMtls: true })

    expect(result).toBe(SUMMARY)
    expect(setPharmacyApiKeyMtls).toHaveBeenCalledWith('pharmacy-1', 'key-1', true)
  })

  it('pharmacy_admin, чужая сеть — CrossTenantAccessDeniedError', async () => {
    const { onboardingFacade, inventoryFacade, setPharmacyApiKeyMtls } = fakeFacades(OTHER_CHAIN_ID, SUMMARY)
    const useCase = new SetPharmacyApiKeyMtlsUseCase(onboardingFacade, inventoryFacade)

    await expect(
      useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', keyId: 'key-1', requireMtls: true }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(setPharmacyApiKeyMtls).not.toHaveBeenCalled()
  })

  it('не найдено/чужая аптека — NotFoundError', async () => {
    const { onboardingFacade, inventoryFacade } = fakeFacades(OWN_CHAIN_ID, null)
    const useCase = new SetPharmacyApiKeyMtlsUseCase(onboardingFacade, inventoryFacade)

    await expect(
      useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', keyId: 'key-1', requireMtls: true }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
