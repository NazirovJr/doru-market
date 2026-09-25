import { describe, expect, it, vi } from 'vitest'
import type { IdentityFacadePort, IdentityListPage } from '../ports/identity-facade.port.js'
import { ListUsersUseCase } from './list-users.use-case.js'

const PAGE: IdentityListPage = {
  items: [
    {
      id: 'user-1',
      tenantId: 'tenant-1',
      phoneNumber: '+992900000001',
      role: 'pharmacist',
      fullName: 'Ismoilov I.',
      isActive: true,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  ],
  nextCursor: { v: '2026-09-01T00:00:00.000Z', id: 'user-1' },
  hasMore: true,
}

function buildHarness() {
  const listUsersMock = vi.fn<IdentityFacadePort['listUsers']>().mockResolvedValue(PAGE)
  const facade: IdentityFacadePort = {
    listUsers: listUsersMock,
    deactivateUser: vi.fn(),
    changeStaffRole: vi.fn(),
    grantPlatformRole: vi.fn(),
  }
  const useCase = new ListUsersUseCase(facade)
  return { useCase, listUsersMock }
}

describe('ListUsersUseCase', () => {
  it('передаёт filter/limit/cursor в facade.listUsers без изменений', async () => {
    const { useCase, listUsersMock } = buildHarness()
    const cursor = { v: '2026-08-01T00:00:00.000Z', id: 'anchor' }

    await useCase.execute({ filter: { role: 'pharmacist' }, limit: 20, cursor })

    expect(listUsersMock).toHaveBeenCalledWith({ filter: { role: 'pharmacist' }, limit: 20, cursor })
  })

  it('cursor отсутствует в command → facade.listUsers получает cursor: null', async () => {
    const { useCase, listUsersMock } = buildHarness()

    await useCase.execute({ filter: {}, limit: 20 })

    expect(listUsersMock).toHaveBeenCalledWith({ filter: {}, limit: 20, cursor: null })
  })

  it('пробрасывает items/nextCursor/hasMore без изменений', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ filter: {}, limit: 20 })

    expect(result).toEqual(PAGE)
  })
})
