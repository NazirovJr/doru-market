import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import type { IdentityFacadePort, UserSummaryView } from '../ports/identity-facade.port.js'
import type { AuthSessionsRepository, UnitOfWorkPort } from '@/modules/auth/index.js'
import { CrossChainAccessDeniedError } from '../errors/cross-chain-access-denied.error.js'
import { DeactivateStaffAccountUseCase } from './deactivate-staff-account.use-case.js'

const CHAIN_A = '11111111-1111-1111-1111-111111111111'
const CHAIN_B = '22222222-2222-2222-2222-222222222222'
const ACTOR_PHARMACY_ADMIN = { userId: 'admin-1', role: 'pharmacy_admin', chainId: CHAIN_A }
const ACTOR_SUPER_ADMIN = { userId: 'super-1', role: 'super_admin', chainId: null }

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

function buildHarness(params: { readonly target?: UserSummaryView | null; readonly deactivateResult?: UserSummaryView | null } = {}) {
  const target = params.target === undefined ? makeUser() : params.target
  const deactivateResult = params.deactivateResult === undefined ? makeUser({ isActive: false }) : params.deactivateResult
  const getUserMock = vi.fn<NonNullable<IdentityFacadePort['getUser']>>().mockResolvedValue(target)
  const deactivateUserMock = vi.fn<IdentityFacadePort['deactivateUser']>().mockResolvedValue(deactivateResult)
  const facade: IdentityFacadePort = {
    listUsers: vi.fn(),
    deactivateUser: deactivateUserMock,
    changeStaffRole: vi.fn(),
    grantPlatformRole: vi.fn(),
    getUser: getUserMock,
  }
  const revokeAllByUserIdMock = vi.fn<AuthSessionsRepository['revokeAllByUserId']>().mockResolvedValue(1)
  const authSessions: AuthSessionsRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByRefreshHash: vi.fn(),
    findActiveByUserId: vi.fn(),
    revokeCurrentAndCreateNext: vi.fn(),
    revokeAllByFamilyId: vi.fn(),
    revokeOneById: vi.fn(),
    revokeAllByUserId: revokeAllByUserIdMock,
  }
  const uow: UnitOfWorkPort = { run: (fn) => fn({}) }
  const useCase = new DeactivateStaffAccountUseCase(facade, authSessions, uow)
  return { useCase, getUserMock, deactivateUserMock, revokeAllByUserIdMock }
}

describe('DeactivateStaffAccountUseCase (DTJ-364, SRS-ADM-041/042)', () => {
  it('pharmacy_admin деактивирует pharmacist СВОЕЙ сети → успех + отзыв всех сессий (admin_force)', async () => {
    const { useCase, deactivateUserMock, revokeAllByUserIdMock } = buildHarness()

    const result = await useCase.execute({ userId: 'user-1', actor: ACTOR_PHARMACY_ADMIN })

    expect(deactivateUserMock).toHaveBeenCalledWith('user-1', { userId: ACTOR_PHARMACY_ADMIN.userId })
    expect(revokeAllByUserIdMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', reason: 'admin_force' }))
    expect(result.isActive).toBe(false)
  })

  it('pharmacy_admin (chain A) → сотрудник ЧУЖОЙ сети (chain B) → CROSS_TENANT_ACCESS_DENIED, facade НЕ вызван', async () => {
    const { useCase, deactivateUserMock } = buildHarness({ target: makeUser({ chainId: CHAIN_B }) })

    await expect(useCase.execute({ userId: 'user-1', actor: ACTOR_PHARMACY_ADMIN })).rejects.toMatchObject({
      code: 'CROSS_TENANT_ACCESS_DENIED',
    })
    expect(deactivateUserMock).not.toHaveBeenCalled()
  })

  it('pharmacy_admin → цель role="pharmacy_admin" (роль без прав на этом эндпоинте) → ForbiddenError', async () => {
    const { useCase, deactivateUserMock } = buildHarness({ target: makeUser({ role: 'pharmacy_admin' }) })

    await expect(useCase.execute({ userId: 'user-1', actor: ACTOR_PHARMACY_ADMIN })).rejects.toThrow(ForbiddenError)
    expect(deactivateUserMock).not.toHaveBeenCalled()
  })

  it('super_admin → деактивирует сотрудника ЛЮБОЙ сети (без chainId-ограничения)', async () => {
    const { useCase, deactivateUserMock } = buildHarness({ target: makeUser({ chainId: CHAIN_B }) })

    await useCase.execute({ userId: 'user-1', actor: ACTOR_SUPER_ADMIN })

    expect(deactivateUserMock).toHaveBeenCalledWith('user-1', { userId: ACTOR_SUPER_ADMIN.userId })
  })

  it('пользователь не найден → NotFoundError, facade.deactivateUser не вызван', async () => {
    const { useCase, deactivateUserMock } = buildHarness({ target: null })

    await expect(useCase.execute({ userId: 'missing', actor: ACTOR_PHARMACY_ADMIN })).rejects.toThrow(NotFoundError)
    expect(deactivateUserMock).not.toHaveBeenCalled()
  })

  it('CrossChainAccessDeniedError — экземпляр DomainError с кодом CROSS_TENANT_ACCESS_DENIED', () => {
    const error = new CrossChainAccessDeniedError('msg')
    expect(error.code).toBe('CROSS_TENANT_ACCESS_DENIED')
  })
})
