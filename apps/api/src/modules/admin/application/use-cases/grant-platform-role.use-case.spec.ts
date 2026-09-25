import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, ValidationError } from '@dorutj/contracts'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import type { UnitOfWorkPort } from '@/modules/auth/index.js'
import type { IdentityFacadePort, RoleChangeResult } from '../ports/identity-facade.port.js'
import { GrantPlatformRoleUseCase } from './grant-platform-role.use-case.js'

const ACTOR = { userId: 'super-admin-1' }
const FAKE_TX = Symbol('tx')

const RESULT: RoleChangeResult = {
  user: {
    id: 'user-1',
    tenantId: 'tenant-1',
    phoneNumber: '+992900000001',
    role: 'support_agent',
    fullName: 'Ismoilov I.',
    isActive: true,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  },
  previousRole: 'pharmacist',
}

function buildHarness(options: { grantPlatformRoleResult?: RoleChangeResult | null; auditWriteError?: Error } = {}) {
  const grantPlatformRoleMock = vi
    .fn<IdentityFacadePort['grantPlatformRole']>()
    .mockResolvedValue(options.grantPlatformRoleResult === undefined ? RESULT : options.grantPlatformRoleResult)
  const facade: IdentityFacadePort = {
    listUsers: vi.fn(),
    deactivateUser: vi.fn(),
    changeStaffRole: vi.fn(),
    grantPlatformRole: grantPlatformRoleMock,
  }
  const auditWriteMock =
    options.auditWriteError === undefined
      ? vi.fn<AuditLogPort['write']>().mockResolvedValue(undefined)
      : vi.fn<AuditLogPort['write']>().mockRejectedValue(options.auditWriteError)
  const auditLog: AuditLogPort = { write: auditWriteMock }
  // run<T> — генерик, vi.fn<T>() не типизируется поверх него — плоская функция + счётчик.
  let runCallCount = 0
  const unitOfWork: UnitOfWorkPort = {
    run: (cb) => {
      runCallCount += 1
      return cb(FAKE_TX)
    },
  }
  const useCase = new GrantPlatformRoleUseCase(facade, unitOfWork, auditLog)
  return { useCase, grantPlatformRoleMock, auditWriteMock, getRunCallCount: () => runCallCount }
}

describe('GrantPlatformRoleUseCase', () => {
  it('успех → grantPlatformRole и audit.write выполняются внутри ОДНОГО unitOfWork.run, роль+аудит согласованы', async () => {
    const { useCase, grantPlatformRoleMock, auditWriteMock, getRunCallCount } = buildHarness()

    const result = await useCase.execute({ userId: 'user-1', rawBody: { role: 'support_agent', reason: 'onboarding new hire' }, actor: ACTOR, requestId: 'req-1' })

    expect(getRunCallCount()).toBe(1)
    expect(grantPlatformRoleMock).toHaveBeenCalledWith({
      userId: 'user-1',
      role: 'support_agent',
      actor: { userId: ACTOR.userId },
      tx: FAKE_TX,
    })
    expect(auditWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'role_grant',
        entityType: 'user',
        entityId: 'user-1',
        actorUserId: ACTOR.userId,
        reason: 'onboarding new hire',
        metadata: { before: { role: 'pharmacist' }, after: { role: 'support_agent' } },
        requestId: 'req-1',
        tenantId: 'tenant-1',
      }),
    )
    expect(result).toEqual(RESULT.user)
    // Порядок вызовов: смена роли — ПЕРЕД записью аудита (контракт "audit — последний шаг").
    const grantOrder = grantPlatformRoleMock.mock.invocationCallOrder[0]
    const auditOrder = auditWriteMock.mock.invocationCallOrder[0]
    expect(grantOrder).toBeLessThan(auditOrder!)
  })

  it('без reason → ValidationError ДО unitOfWork.run — ни facade, ни audit.write не вызываются', async () => {
    const { useCase, grantPlatformRoleMock, auditWriteMock, getRunCallCount } = buildHarness()

    const error = await useCase
      .execute({ userId: 'user-1', rawBody: { role: 'support_agent' }, actor: ACTOR, requestId: null })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect(getRunCallCount()).toBe(0)
    expect(grantPlatformRoleMock).not.toHaveBeenCalled()
    expect(auditWriteMock).not.toHaveBeenCalled()
  })

  it('reason короче 10 символов → ValidationError', async () => {
    const { useCase } = buildHarness()

    await expect(
      useCase.execute({ userId: 'user-1', rawBody: { role: 'support_agent', reason: 'short' }, actor: ACTOR, requestId: null }),
    ).rejects.toThrow(ValidationError)
  })

  it('role вне PLATFORM_ROLE_VALUES (например pharmacist) → ValidationError', async () => {
    const { useCase, grantPlatformRoleMock } = buildHarness()

    await expect(
      useCase.execute({ userId: 'user-1', rawBody: { role: 'pharmacist', reason: 'valid enough reason' }, actor: ACTOR, requestId: null }),
    ).rejects.toThrow(ValidationError)
    expect(grantPlatformRoleMock).not.toHaveBeenCalled()
  })

  it('audit.write() бросает → execute() отклоняется, ошибка не проглатывается (роль внутри незакоммиченной транзакции)', async () => {
    const { useCase, grantPlatformRoleMock, auditWriteMock } = buildHarness({ auditWriteError: new Error('audit down') })

    await expect(
      useCase.execute({ userId: 'user-1', rawBody: { role: 'support_agent', reason: 'onboarding new hire' }, actor: ACTOR, requestId: null }),
    ).rejects.toThrow('audit down')
    // grantPlatformRole вызван ДО ошибки audit.write — откат транзакции откатывает оба эффекта.
    expect(grantPlatformRoleMock).toHaveBeenCalledTimes(1)
    expect(auditWriteMock).toHaveBeenCalledTimes(1)
  })

  it('пользователь не найден (facade вернул null) → NotFoundError, audit.write не вызывается', async () => {
    const { useCase, auditWriteMock } = buildHarness({ grantPlatformRoleResult: null })

    await expect(
      useCase.execute({ userId: 'missing', rawBody: { role: 'support_agent', reason: 'onboarding new hire' }, actor: ACTOR, requestId: null }),
    ).rejects.toThrow(NotFoundError)
    expect(auditWriteMock).not.toHaveBeenCalled()
  })
})
