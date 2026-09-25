import { describe, expect, it, vi } from 'vitest'
import type { IdentityFacadePort, IdentityListPage, UserSummaryView } from '../ports/identity-facade.port.js'
import { ListStaffAccountsUseCase } from './list-staff-accounts.use-case.js'

const CHAIN_A = '11111111-1111-1111-1111-111111111111'

function makeUser(overrides: Partial<UserSummaryView> = {}): UserSummaryView {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    phoneNumber: '+992900000001',
    role: 'pharmacist',
    fullName: 'Ismoilov I.',
    isActive: true,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    chainId: CHAIN_A,
    pharmacyId: null,
    ...overrides,
  }
}

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
  it('pharmacy_admin → filter.chainId резолвится СЕРВЕРОМ из actor.chainId', async () => {
    const { useCase, listUsersMock } = buildHarness({ items: [], nextCursor: null, hasMore: false })

    await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: CHAIN_A }, limit: 20 })

    expect(listUsersMock).toHaveBeenCalledWith({ filter: { chainId: CHAIN_A }, limit: 20, cursor: null })
  })

  it('super_admin → БЕЗ сетевого фильтра (видит весь штат)', async () => {
    const { useCase, listUsersMock } = buildHarness({ items: [], nextCursor: null, hasMore: false })

    await useCase.execute({ actor: { role: 'super_admin', chainId: null }, limit: 20 })

    expect(listUsersMock).toHaveBeenCalledWith({ filter: {}, limit: 20, cursor: null })
  })

  it('отфильтровывает роли вне {pharmacist, courier} (напр. pharmacy_admin-строки той же сети)', async () => {
    const page: IdentityListPage = {
      items: [makeUser({ id: 'u-pharmacist', role: 'pharmacist' }), makeUser({ id: 'u-admin', role: 'pharmacy_admin' }), makeUser({ id: 'u-courier', role: 'courier' })],
      nextCursor: null,
      hasMore: false,
    }
    const { useCase } = buildHarness(page)

    const result = await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: CHAIN_A }, limit: 20 })

    expect(result.items.map((u) => u.id)).toEqual(['u-pharmacist', 'u-courier'])
  })

  it('пробрасывает nextCursor/hasMore без изменений (курсор остаётся валиден для полной, не отфильтрованной, страницы)', async () => {
    const page: IdentityListPage = {
      items: [makeUser()],
      nextCursor: { v: '2026-09-01T00:00:00.000Z', id: 'user-1' },
      hasMore: true,
    }
    const { useCase } = buildHarness(page)

    const result = await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: CHAIN_A }, limit: 20 })

    expect(result.nextCursor).toEqual(page.nextCursor)
    expect(result.hasMore).toBe(true)
  })
})
