import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import type { IdentityFacadePort, UserSummaryView } from '../ports/identity-facade.port.js'
import { DeactivateUserUseCase } from './deactivate-user.use-case.js'

const ACTOR = { userId: 'super-admin-1' }

const DEACTIVATED: UserSummaryView = {
  id: 'user-1',
  tenantId: 'tenant-1',
  phoneNumber: '+992900000001',
  role: 'pharmacist',
  fullName: 'Ismoilov I.',
  isActive: false,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
}

function buildHarness(deactivateUserResult: UserSummaryView | null = DEACTIVATED) {
  const deactivateUserMock = vi.fn<IdentityFacadePort['deactivateUser']>().mockResolvedValue(deactivateUserResult)
  const facade: IdentityFacadePort = {
    listUsers: vi.fn(),
    deactivateUser: deactivateUserMock,
    changeStaffRole: vi.fn(),
    grantPlatformRole: vi.fn(),
  }
  const useCase = new DeactivateUserUseCase(facade)
  return { useCase, deactivateUserMock }
}

describe('DeactivateUserUseCase', () => {
  it('успех → вызывает facade.deactivateUser и возвращает обновлённое представление', async () => {
    const { useCase, deactivateUserMock } = buildHarness()

    const result = await useCase.execute({ userId: 'user-1', actor: ACTOR })

    expect(deactivateUserMock).toHaveBeenCalledWith('user-1', { userId: ACTOR.userId })
    expect(result).toEqual(DEACTIVATED)
  })

  it('actor.userId === userId (попытка деактивировать себя) → ForbiddenError, facade не вызван', async () => {
    const { useCase, deactivateUserMock } = buildHarness()

    await expect(useCase.execute({ userId: ACTOR.userId, actor: ACTOR })).rejects.toThrow(ForbiddenError)
    expect(deactivateUserMock).not.toHaveBeenCalled()
  })

  it('пользователь не найден (facade вернул null) → NotFoundError', async () => {
    const { useCase } = buildHarness(null)

    await expect(useCase.execute({ userId: 'missing', actor: ACTOR })).rejects.toThrow(NotFoundError)
  })
})
