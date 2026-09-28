import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError, NotFoundError } from '@dorutj/contracts'
import { GetPharmacyScheduleUseCase } from './get-pharmacy-schedule.use-case.js'
import type { OnboardingFacadePort, PharmacyScheduleAndZoneView } from '../ports/onboarding-facade.port.js'

const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'
const VIEW: PharmacyScheduleAndZoneView = { id: 'pharmacy-1', isOpen247: false, openingTime: '09:00', closingTime: '18:00', maxDeliveryRadiusKm: 10 }

function fakeFacade(chainId: string | null, view: PharmacyScheduleAndZoneView | null): OnboardingFacadePort {
  return {
    findPharmacyAccountsAny: vi.fn(),
    getPharmacyChainId: vi.fn().mockResolvedValue(chainId),
    getScheduleAndZone: vi.fn().mockResolvedValue(view),
    updateSchedule: vi.fn(),
    updateDeliveryZone: vi.fn(),
    liftInvoiceBlock: vi.fn(),
    findChainNames: vi.fn(),
  }
}

describe('GetPharmacyScheduleUseCase (DTJ-367)', () => {
  it('pharmacy_admin, своя аптека — возвращает текущие значения', async () => {
    const useCase = new GetPharmacyScheduleUseCase(fakeFacade(OWN_CHAIN_ID, VIEW))
    const result = await useCase.execute({ pharmacyId: 'pharmacy-1', actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID } })
    expect(result).toEqual(VIEW)
  })

  it('pharmacy_admin, чужая сеть — CrossTenantAccessDeniedError', async () => {
    const useCase = new GetPharmacyScheduleUseCase(fakeFacade(OTHER_CHAIN_ID, VIEW))
    await expect(
      useCase.execute({ pharmacyId: 'pharmacy-1', actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID } }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
  })

  it('аптека не существует — NotFoundError', async () => {
    const useCase = new GetPharmacyScheduleUseCase(fakeFacade(null, null))
    await expect(useCase.execute({ pharmacyId: 'pharmacy-1', actor: { role: 'super_admin', chainId: null } })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('super_admin — владение не проверяется', async () => {
    const useCase = new GetPharmacyScheduleUseCase(fakeFacade(OTHER_CHAIN_ID, VIEW))
    const result = await useCase.execute({ pharmacyId: 'pharmacy-1', actor: { role: 'super_admin', chainId: null } })
    expect(result).toEqual(VIEW)
  })
})
