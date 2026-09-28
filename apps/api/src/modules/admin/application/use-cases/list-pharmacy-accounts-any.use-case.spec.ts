import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError } from '@dorutj/contracts'
import { ListPharmacyAccountsAnyUseCase } from './list-pharmacy-accounts-any.use-case.js'
import type { OnboardingFacadePort, PharmacyAccountsAnyPage } from '../ports/onboarding-facade.port.js'

function fakeFacade(page: PharmacyAccountsAnyPage): { facade: OnboardingFacadePort; findPharmacyAccountsAny: ReturnType<typeof vi.fn> } {
  const findPharmacyAccountsAny = vi.fn().mockResolvedValue(page)
  return {
    facade: {
      findPharmacyAccountsAny,
      getPharmacyChainId: vi.fn(),
      getScheduleAndZone: vi.fn(),
      updateSchedule: vi.fn(),
      updateDeliveryZone: vi.fn(),
      liftInvoiceBlock: vi.fn(),
      findChainNames: vi.fn(),
    },
    findPharmacyAccountsAny,
  }
}

const EMPTY_PAGE: PharmacyAccountsAnyPage = { items: [], nextCursor: null, hasMore: false }

describe('ListPharmacyAccountsAnyUseCase (DTJ-353)', () => {
  it('super_admin — пробрасывает filter/limit/cursor в порт без изменений', async () => {
    const page: PharmacyAccountsAnyPage = {
      items: [{ id: 'acc-1', chainId: 'chain-1', chainName: 'Salom Pharmacy Network', name: 'Salom Pharmacy #1', status: 'terminated', licenseExpiryDate: null }],
      nextCursor: null,
      hasMore: false,
    }
    const { facade, findPharmacyAccountsAny } = fakeFacade(page)
    const useCase = new ListPharmacyAccountsAnyUseCase(facade)

    const result = await useCase.execute({
      actor: { role: 'super_admin' },
      filter: { status: 'terminated' },
      limit: 20,
      cursor: { v: '2026-09-01T00:00:00.000Z', id: 'acc-0' },
    })

    expect(findPharmacyAccountsAny).toHaveBeenCalledWith(
      { status: 'terminated' },
      { limit: 20, cursor: { v: '2026-09-01T00:00:00.000Z', id: 'acc-0' } },
    )
    // Критерий приёмки №1: super_admin видит ВСЕ статусы, включая terminated.
    expect(result.items[0]?.status).toBe('terminated')
  })

  it('super_admin, курсор не передан — cursor: null уходит в порт (не undefined)', async () => {
    const { facade, findPharmacyAccountsAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListPharmacyAccountsAnyUseCase(facade)

    await useCase.execute({ actor: { role: 'super_admin' }, filter: {}, limit: 20 })

    expect(findPharmacyAccountsAny).toHaveBeenCalledWith({}, { limit: 20, cursor: null })
  })

  it('pharmacy_admin (без scope=own — политика применяется ДО обращения к порту) — CrossTenantAccessDeniedError, порт НЕ вызывается', async () => {
    const { facade, findPharmacyAccountsAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListPharmacyAccountsAnyUseCase(facade)

    await expect(useCase.execute({ actor: { role: 'pharmacy_admin' }, filter: {}, limit: 20 })).rejects.toBeInstanceOf(
      CrossTenantAccessDeniedError,
    )
    expect(findPharmacyAccountsAny).not.toHaveBeenCalled()
  })

  it('любая другая не-super_admin роль (напр. pharmacist) — тот же отказ', async () => {
    const { facade, findPharmacyAccountsAny } = fakeFacade(EMPTY_PAGE)
    const useCase = new ListPharmacyAccountsAnyUseCase(facade)

    await expect(useCase.execute({ actor: { role: 'pharmacist' }, filter: {}, limit: 20 })).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(findPharmacyAccountsAny).not.toHaveBeenCalled()
  })
})
