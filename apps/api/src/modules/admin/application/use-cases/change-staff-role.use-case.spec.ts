import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, ValidationError } from '@dorutj/contracts'
import type { IdentityFacadePort, RoleChangeResult } from '../ports/identity-facade.port.js'
import { ChangeStaffRoleUseCase } from './change-staff-role.use-case.js'

const ACTOR = { userId: 'super-admin-1' }

const RESULT: RoleChangeResult = {
  user: {
    id: 'user-1',
    tenantId: 'tenant-1',
    phoneNumber: '+992900000001',
    role: 'courier',
    fullName: 'Ismoilov I.',
    isActive: true,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  },
  previousRole: 'pharmacist',
}

function buildHarness(changeStaffRoleResult: RoleChangeResult | null = RESULT) {
  const changeStaffRoleMock = vi.fn<IdentityFacadePort['changeStaffRole']>().mockResolvedValue(changeStaffRoleResult)
  const facade: IdentityFacadePort = {
    listUsers: vi.fn(),
    deactivateUser: vi.fn(),
    changeStaffRole: changeStaffRoleMock,
    grantPlatformRole: vi.fn(),
  }
  const useCase = new ChangeStaffRoleUseCase(facade)
  return { useCase, changeStaffRoleMock }
}

describe('ChangeStaffRoleUseCase', () => {
  it('newRole=courier (бытовая роль) → вызывает facade.changeStaffRole и возвращает user', async () => {
    const { useCase, changeStaffRoleMock } = buildHarness()

    const result = await useCase.execute({ userId: 'user-1', rawBody: { newRole: 'courier' }, actor: ACTOR })

    expect(changeStaffRoleMock).toHaveBeenCalledWith({ userId: 'user-1', newRole: 'courier', actor: { userId: ACTOR.userId } })
    expect(result).toEqual(RESULT.user)
  })

  // AC1 DTJ-354: платформенная роль недостижима через эту схему независимо от роли вызывающего —
  // actor здесь произвольный, use case вызывается напрямую в обход HTTP-guard'а.
  it.each(['super_admin', 'support_agent'] as const)(
    'newRole=%s (платформенная роль) → ValidationError, facade не вызван',
    async (newRole) => {
      const { useCase, changeStaffRoleMock } = buildHarness()

      const error = await useCase
        .execute({ userId: 'user-1', rawBody: { newRole }, actor: ACTOR })
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ValidationError)
      expect(changeStaffRoleMock).not.toHaveBeenCalled()
    },
  )

  it('newRole=customer → ValidationError (не входит в список бытовых ролей use case)', async () => {
    const { useCase, changeStaffRoleMock } = buildHarness()

    await expect(
      useCase.execute({ userId: 'user-1', rawBody: { newRole: 'customer' }, actor: ACTOR }),
    ).rejects.toThrow(ValidationError)
    expect(changeStaffRoleMock).not.toHaveBeenCalled()
  })

  it('пользователь не найден (facade вернул null) → NotFoundError', async () => {
    const { useCase } = buildHarness(null)

    await expect(
      useCase.execute({ userId: 'missing', rawBody: { newRole: 'courier' }, actor: ACTOR }),
    ).rejects.toThrow(NotFoundError)
  })
})
