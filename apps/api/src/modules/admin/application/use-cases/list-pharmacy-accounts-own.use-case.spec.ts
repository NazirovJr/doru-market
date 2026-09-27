import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError } from '@dorutj/contracts'
import { ListPharmacyAccountsOwnUseCase } from './list-pharmacy-accounts-own.use-case.js'
import type { OnboardingFacadePort, PharmacyAccountsAnyPage } from '../ports/onboarding-facade.port.js'

function fakeFacade(page: PharmacyAccountsAnyPage): { facade: OnboardingFacadePort; findPharmacyAccountsAny: ReturnType<typeof vi.fn> } {
  const findPharmacyAccountsAny = vi.fn().mockResolvedValue(page)
  return { facade: { findPharmacyAccountsAny, getPharmacyChainId: vi.fn(), getScheduleAndZone: vi.fn(), updateSchedule: vi.fn(), updateDeliveryZone: vi.fn() }, findPharmacyAccountsAny }
}

const EMPTY_PAGE: PharmacyAccountsAnyPage = { items: [], nextCursor: null, hasMore: false }
const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'

describe('ListPharmacyAccountsOwnUseCase (DTJ-362)', () => {
  it('pharmacy_admin — резолвит chainId ИЗ actor, а не из filter (filter вообще не несёт chainId)', async () => {
    const page: PharmacyAccountsAnyPage = {
      items: [{ id: 'acc-1', chainId: OWN_CHAIN_ID, chainName: 'Salom Pharmacy Network', name: 'Salom Pharmacy #1', status: 'active', licenseExpiryDate: null }],
      nextCursor: null,
      hasMore: false,
    }
    const { facade, findPharmacyAccountsAny } = fakeFacade(page)
    const useCase = new ListPharmacyAccountsOwnUseCase(facade)

    const result = await useCase.execute({
      actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID },
      filter: { status: 'active' },
      limit: 20,
    })

    expect(findPharmacyAccountsAny).toHaveBeenCalledWith({ status: 'active', chainId: OWN_CHAIN_ID }, { limit: 20, cursor: null })
    expect(result.items[0]?.chainId).toBe(OWN_CHAIN_ID)
  })

  // Даже если бы что-то попыталось передать чужой chainId, тип PharmacyAccountsOwnFilter его не
  // несёт вовсе — use case физически не может его прочитать.
  it('pharmacy_admin — filter не содержит chainId, порт получает ТОЛЬКО actor.chainId', async () => {
    const { facade, findPharmacyAccountsAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListPharmacyAccountsOwnUseCase(facade)

    await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, filter: {}, limit: 20 })

    const [calledFilter] = findPharmacyAccountsAny.mock.calls[0] as [Record<string, unknown>]
    expect(calledFilter).toEqual({ chainId: OWN_CHAIN_ID })
    expect(calledFilter.chainId).not.toBe(OTHER_CHAIN_ID)
  })

  it('pharmacy_admin без chainId в actor (некорректный токен) — CrossTenantAccessDeniedError, порт НЕ вызывается', async () => {
    const { facade, findPharmacyAccountsAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListPharmacyAccountsOwnUseCase(facade)

    await expect(useCase.execute({ actor: { role: 'pharmacy_admin', chainId: null }, filter: {}, limit: 20 })).rejects.toBeInstanceOf(
      CrossTenantAccessDeniedError,
    )
    expect(findPharmacyAccountsAny).not.toHaveBeenCalled()
  })

  it('super_admin, вызывающий scope=own напрямую — тот же отказ (own предназначен только pharmacy_admin)', async () => {
    const { facade, findPharmacyAccountsAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListPharmacyAccountsOwnUseCase(facade)

    await expect(useCase.execute({ actor: { role: 'super_admin', chainId: null }, filter: {}, limit: 20 })).rejects.toBeInstanceOf(
      CrossTenantAccessDeniedError,
    )
    expect(findPharmacyAccountsAny).not.toHaveBeenCalled()
  })

  it('курсор не передан — cursor: null уходит в порт (не undefined)', async () => {
    const { facade, findPharmacyAccountsAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListPharmacyAccountsOwnUseCase(facade)

    await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, filter: {}, limit: 20 })

    expect(findPharmacyAccountsAny).toHaveBeenCalledWith({ chainId: OWN_CHAIN_ID }, { limit: 20, cursor: null })
  })
})
