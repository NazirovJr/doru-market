import { describe, expect, it, vi } from 'vitest'
import type { IdentityFacadePort, IdentityListPage } from '../ports/identity-facade.port.js'
import { ListStaffAccountsUseCase } from './list-staff-accounts.use-case.js'

const CHAIN_A = '11111111-1111-1111-1111-111111111111'

function buildHarness(page: IdentityListPage) {
  const listUsersMock = vi.fn<IdentityFacadePort['listUsers']>().mockResolvedValue(page)
  const facade: IdentityFacadePort = {
    listUsers: listUsersMock,
    deactivateUser: vi.fn(),
    changeStaffRole: vi.fn(),
    grantPlatformRole: vi.fn(),
  }
  const useCase = new ListStaffAccountsUseCase(facade)
  return { useCase, listUsersMock }
}

describe('ListStaffAccountsUseCase (DTJ-364, SRS-ADM-039/041)', () => {
  it('pharmacy_admin → filter.roles={pharmacist,courier} + filter.chainId резолвится СЕРВЕРОМ из actor.chainId', async () => {
    const { useCase, listUsersMock } = buildHarness({ items: [], nextCursor: null, hasMore: false })

    await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: CHAIN_A }, limit: 20 })

    expect(listUsersMock).toHaveBeenCalledWith({ filter: { roles: ['pharmacist', 'courier'], chainId: CHAIN_A }, limit: 20, cursor: null })
  })

  it('super_admin → filter.roles={pharmacist,courier} БЕЗ сетевого фильтра (видит весь штат)', async () => {
    const { useCase, listUsersMock } = buildHarness({ items: [], nextCursor: null, hasMore: false })

    await useCase.execute({ actor: { role: 'super_admin', chainId: null }, limit: 20 })

    expect(listUsersMock).toHaveBeenCalledWith({ filter: { roles: ['pharmacist', 'courier'] }, limit: 20, cursor: null })
  })

  it('пробрасывает items/nextCursor/hasMore без изменений — фильтрация роли на стороне SQL (listUsers.filter.roles), не в памяти', async () => {
    const page: IdentityListPage = {
      items: [],
      nextCursor: { v: '2026-09-01T00:00:00.000Z', id: 'user-1' },
      hasMore: true,
    }
    const { useCase } = buildHarness(page)

    const result = await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: CHAIN_A }, limit: 20 })

    expect(result).toEqual(page)
  })
})
