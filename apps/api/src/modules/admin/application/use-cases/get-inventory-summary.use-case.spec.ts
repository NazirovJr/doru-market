import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError } from '@dorutj/contracts'
import { GetInventorySummaryUseCase } from './get-inventory-summary.use-case.js'
import type { OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import type { InventoryFacadePort, InventorySummaryView } from '../ports/inventory-facade.port.js'

const SUMMARY: InventorySummaryView = { skuCount: 42, staleDataSharePercent: 10 }
const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'

function fakeFacades(
  chainId: string | null,
): {
  onboardingFacade: OnboardingFacadePort
  inventoryFacade: InventoryFacadePort
  getPharmacyChainId: ReturnType<typeof vi.fn>
  getInventorySummary: ReturnType<typeof vi.fn>
} {
  const getPharmacyChainId = vi.fn().mockResolvedValue(chainId)
  const getInventorySummary = vi.fn().mockResolvedValue(SUMMARY)
  return {
    onboardingFacade: {
      findPharmacyAccountsAny: vi.fn(),
      getPharmacyChainId,
      getScheduleAndZone: vi.fn(),
      updateSchedule: vi.fn(),
      updateDeliveryZone: vi.fn(),
      liftInvoiceBlock: vi.fn(),
      findChainNames: vi.fn(),
    },
    inventoryFacade: {
      getInventorySummary,
      createPharmacyApiKey: vi.fn(),
      listPharmacyApiKeys: vi.fn(),
      revokePharmacyApiKey: vi.fn(),
      rotatePharmacyApiKey: vi.fn(),
      setPharmacyApiKeyMtls: vi.fn(),
    },
    getPharmacyChainId,
    getInventorySummary,
  }
}

describe('GetInventorySummaryUseCase (DTJ-362)', () => {
  it('pharmacy_admin, аптека принадлежит его сети — возвращает сводку', async () => {
    const { onboardingFacade, inventoryFacade, getInventorySummary } = fakeFacades(OWN_CHAIN_ID)
    const useCase = new GetInventorySummaryUseCase(onboardingFacade, inventoryFacade)

    const result = await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1' })

    expect(result).toEqual(SUMMARY)
    expect(getInventorySummary).toHaveBeenCalledWith('pharmacy-1')
  })

  it('pharmacy_admin, аптека принадлежит ЧУЖОЙ сети — CrossTenantAccessDeniedError, inventory НЕ вызывается', async () => {
    const { onboardingFacade, inventoryFacade, getInventorySummary } = fakeFacades(OTHER_CHAIN_ID)
    const useCase = new GetInventorySummaryUseCase(onboardingFacade, inventoryFacade)

    await expect(
      useCase.execute({ actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1' }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(getInventorySummary).not.toHaveBeenCalled()
  })

  it('pharmacy_admin, аптека не найдена (getPharmacyChainId: null) — тот же отказ, inventory НЕ вызывается', async () => {
    const { onboardingFacade, inventoryFacade, getInventorySummary } = fakeFacades(null)
    const useCase = new GetInventorySummaryUseCase(onboardingFacade, inventoryFacade)

    await expect(
      useCase.execute({ actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1' }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(getInventorySummary).not.toHaveBeenCalled()
  })

  it('pharmacy_admin без chainId в actor — отказ ДО обращения к OnboardingFacade вовсе', async () => {
    const { onboardingFacade, inventoryFacade, getPharmacyChainId, getInventorySummary } = fakeFacades(OWN_CHAIN_ID)
    const useCase = new GetInventorySummaryUseCase(onboardingFacade, inventoryFacade)

    await expect(
      useCase.execute({ actor: { role: 'pharmacy_admin', chainId: null }, pharmacyId: 'pharmacy-1' }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(getPharmacyChainId).not.toHaveBeenCalled()
    expect(getInventorySummary).not.toHaveBeenCalled()
  })

  it('super_admin — владение НЕ проверяется, любая аптека', async () => {
    const { onboardingFacade, inventoryFacade, getPharmacyChainId, getInventorySummary } = fakeFacades(OTHER_CHAIN_ID)
    const useCase = new GetInventorySummaryUseCase(onboardingFacade, inventoryFacade)

    const result = await useCase.execute({ actor: { role: 'super_admin', chainId: null }, pharmacyId: 'pharmacy-1' })

    expect(result).toEqual(SUMMARY)
    expect(getPharmacyChainId).not.toHaveBeenCalled()
    expect(getInventorySummary).toHaveBeenCalledWith('pharmacy-1')
  })
})
