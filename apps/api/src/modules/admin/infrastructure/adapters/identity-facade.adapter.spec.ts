import { describe, expect, it, vi } from 'vitest'
import type { User, UsersRepository } from '@/modules/auth/index.js'
import { IdentityFacadeAdapter } from './identity-facade.adapter.js'

const USER: User = {
  id: 'user-1',
  tenantId: 'tenant-1',
  phoneNumber: '+992900000001',
  role: 'pharmacist',
  fullName: 'Ismoilov I.',
  pharmacyId: null,
  chainId: null,
  telegramChatId: null,
  preferredLocale: 'tj',
  isActive: true,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  deletedAt: null,
}

function buildHarness() {
  const findByIdMock = vi.fn<UsersRepository['findById']>().mockResolvedValue(USER)
  const listMock = vi.fn<UsersRepository['list']>().mockResolvedValue({ items: [USER], nextCursor: null, hasMore: false })
  const setActiveMock = vi.fn<UsersRepository['setActive']>().mockResolvedValue({ ...USER, isActive: false })
  const setRoleMock = vi.fn<UsersRepository['setRole']>().mockResolvedValue({ ...USER, role: 'courier' })
  const repository: UsersRepository = {
    findByTenantAndPhone: vi.fn(),
    findById: findByIdMock,
    create: vi.fn(),
    findOrCreateByTenantAndPhone: vi.fn(),
    findActiveByPhone: vi.fn(),
    update: vi.fn(),
    list: listMock,
    setActive: setActiveMock,
    setRole: setRoleMock,
  }
  return { adapter: new IdentityFacadeAdapter(repository), findByIdMock, listMock, setActiveMock, setRoleMock }
}

describe('IdentityFacadeAdapter', () => {
  it('listUsers — прокидывает фильтр/limit/cursor в repository.list и мапит User → UserSummaryView', async () => {
    const { adapter, listMock } = buildHarness()

    const page = await adapter.listUsers({ filter: { role: 'pharmacist' }, limit: 20, cursor: null })

    expect(listMock).toHaveBeenCalledWith({ filter: { role: 'pharmacist' }, limit: 20, cursor: null })
    expect(page.items).toEqual([
      { id: 'user-1', tenantId: 'tenant-1', phoneNumber: '+992900000001', role: 'pharmacist', fullName: 'Ismoilov I.', isActive: true, createdAt: USER.createdAt },
    ])
  })

  it('deactivateUser — вызывает repository.setActive(id, false)', async () => {
    const { adapter, setActiveMock } = buildHarness()

    const result = await adapter.deactivateUser('user-1', { userId: 'admin-1' })

    expect(setActiveMock).toHaveBeenCalledWith('user-1', false)
    expect(result?.isActive).toBe(false)
  })

  it('deactivateUser — repository.setActive вернул null (не найден) → null', async () => {
    const { adapter, setActiveMock } = buildHarness()
    setActiveMock.mockResolvedValueOnce(null)

    const result = await adapter.deactivateUser('missing', { userId: 'admin-1' })

    expect(result).toBeNull()
  })

  it('changeStaffRole — читает previousRole ДО setRole, возвращает { user, previousRole }', async () => {
    const { adapter, findByIdMock, setRoleMock } = buildHarness()

    const result = await adapter.changeStaffRole({ userId: 'user-1', newRole: 'courier', actor: { userId: 'admin-1' } })

    expect(findByIdMock).toHaveBeenCalledWith('user-1', undefined)
    expect(setRoleMock).toHaveBeenCalledWith('user-1', 'courier', undefined)
    expect(result?.previousRole).toBe('pharmacist')
    expect(result?.user.role).toBe('courier')
  })

  it('grantPlatformRole — прокидывает tx в findById/setRole (атомарность с audit.write извне)', async () => {
    const { adapter, findByIdMock, setRoleMock } = buildHarness()
    const tx = Symbol('tx')

    await adapter.grantPlatformRole({ userId: 'user-1', role: 'support_agent', actor: { userId: 'admin-1' }, tx })

    expect(findByIdMock).toHaveBeenCalledWith('user-1', tx)
    expect(setRoleMock).toHaveBeenCalledWith('user-1', 'support_agent', tx)
  })

  it('changeStaffRole — пользователь не найден (findById вернул null) → null, setRole не вызывается', async () => {
    const { adapter, findByIdMock, setRoleMock } = buildHarness()
    findByIdMock.mockResolvedValueOnce(null)

    const result = await adapter.changeStaffRole({ userId: 'missing', newRole: 'courier', actor: { userId: 'admin-1' } })

    expect(result).toBeNull()
    expect(setRoleMock).not.toHaveBeenCalled()
  })
})
