/**
 * `AuthGuard` — unit-набор (EP-01, DTJ-022; DTJ-233 добавляет регресс-покрытие
 * `RequestContext.patch` — до этого файла у guard'а НЕ было юнит-тестов вовсе). Фокус:
 * успешная аутентификация обязана заполнить И `request.authClaims` (`@CurrentUser()`), И
 * `RequestContext` (`userId`/`role`, foundIssue DTJ-233 — JSDoc файла обещал это с DTJ-022, код
 * не делал; см. JSDoc `auth.guard.ts`/`test/integration/orders/__tests__/test-app.ts`).
 * DTJ-443: токен отозванной сессии отклоняется.
 */
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'
import { ok, err } from '@dorutj/domain-kernel'
import type { JwtClaims, JwtSignerPort } from '@/modules/auth/index.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { RequestContext, type RequestContextStore } from '@/common/context/request-context.js'
import type { SessionStatusService } from '@/modules/auth/application/services/session-status.service.js'
import { AuthGuard } from './auth.guard.js'

const CLAIMS: JwtClaims = {
  sub: 'customer-1',
  role: 'customer',
  tenantId: 'tenant-1',
  pharmacyId: null,
  chainId: null,
  sessionId: 'session-1',
}

function buildContext(headers: Record<string, string | string[] | undefined>): {
  context: ExecutionContext
  request: { headers: typeof headers; authClaims?: JwtClaims }
} {
  const request: { headers: typeof headers; authClaims?: JwtClaims } = { headers }
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext
  return { context, request }
}

function buildReflector(isPublic = false): Reflector {
  return { getAllAndOverride: vi.fn(() => isPublic) } as unknown as Reflector
}

function buildJwtSigner(overrides: Partial<JwtSignerPort> = {}): JwtSignerPort {
  return {
    sign: vi.fn(() => 'token'),
    verify: vi.fn(() => ok(CLAIMS)),
    ...overrides,
  }
}

function buildSessionStatus(revoked = false): { readonly isRevoked: ReturnType<typeof vi.fn> } {
  return { isRevoked: vi.fn(() => Promise.resolve(revoked)) }
}

function buildGuard(
  options: {
    isPublic?: boolean
    jwtSigner?: JwtSignerPort
    sessionStatus?: ReturnType<typeof buildSessionStatus>
  } = {},
): AuthGuard {
  return new AuthGuard(
    buildReflector(options.isPublic ?? false),
    options.jwtSigner ?? buildJwtSigner(),
    (options.sessionStatus ?? buildSessionStatus()) as unknown as SessionStatusService,
  )
}

function inTenant<T>(tenantId: string, fn: () => T): T {
  return TenantContext.run(TenantContext.forTenant({ tenantId, slug: 's', chainId: null, isNeutral: false }), fn)
}

/** Требуется активный `RequestContext.run()`-скоуп — `patch()` вне него молча no-op'ает. */
async function runWithRequestContext(fn: () => Promise<unknown>): Promise<RequestContextStore> {
  const store: RequestContextStore = { requestId: 'req-1', tenantId: null, userId: null, role: null }
  await RequestContext.run(store, fn)
  return store
}

describe('AuthGuard (DTJ-022, foundIssue DTJ-233 — RequestContext.patch)', () => {
  it('@Public() — пропускает без проверки токена и статуса сессии, request.authClaims не заполняется', async () => {
    const sessionStatus = buildSessionStatus()
    const guard = buildGuard({ isPublic: true, sessionStatus })
    const { context, request } = buildContext({})

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(request.authClaims).toBeUndefined()
    expect(sessionStatus.isRevoked).not.toHaveBeenCalled()
  })

  it('нет заголовка Authorization — 401 UNAUTHENTICATED', async () => {
    const { context } = buildContext({})

    await expect(buildGuard().canActivate(context)).rejects.toThrow(UnauthorizedException)
  })

  it('невалидная схема (не Bearer) — 401 UNAUTHENTICATED', async () => {
    const { context } = buildContext({ authorization: 'Basic abc' })

    await expect(buildGuard().canActivate(context)).rejects.toThrow(UnauthorizedException)
  })

  it('JwtSignerPort.verify → TOKEN_EXPIRED — 401 TOKEN_EXPIRED', async () => {
    const jwtSigner = buildJwtSigner({
      verify: vi.fn(() => err({ code: 'TOKEN_EXPIRED', message: 'expired', name: 'JwtVerificationError' } as never)),
    })
    const { context } = buildContext({ authorization: 'Bearer expired-token' })

    await expect(inTenant('tenant-1', () => buildGuard({ jwtSigner }).canActivate(context))).rejects.toThrow(
      UnauthorizedException,
    )
  })

  it('валидный токен, тенант совпадает — заполняет request.authClaims (customer-роль, не super_admin)', async () => {
    const { context, request } = buildContext({ authorization: 'Bearer valid-token' })

    await expect(inTenant('tenant-1', () => buildGuard().canActivate(context))).resolves.toBe(true)

    expect(request.authClaims).toEqual(CLAIMS)
  })

  it('claims.tenantId ≠ резолвленный тенант — 403 CROSS_TENANT_ACCESS_DENIED (не super_admin)', async () => {
    const { context } = buildContext({ authorization: 'Bearer valid-token' })

    await expect(inTenant('OTHER-tenant', () => buildGuard().canActivate(context))).rejects.toThrow(
      UnauthorizedException,
    )
  })

  it('foundIssue DTJ-233 — успешная аутентификация вызывает RequestContext.patch({userId, role}), а не оставляет их null', async () => {
    const { context } = buildContext({ authorization: 'Bearer valid-token' })

    const store = await runWithRequestContext(() => inTenant('tenant-1', () => buildGuard().canActivate(context)))

    expect(store.userId).toBe(CLAIMS.sub)
    expect(store.role).toBe(CLAIMS.role)
  })

  it('super_admin (tenantId=null) — пропускает cross-tenant проверку, RequestContext.patch всё равно вызывается', async () => {
    const superAdminClaims: JwtClaims = { ...CLAIMS, role: 'super_admin', tenantId: null }
    const guard = buildGuard({ jwtSigner: buildJwtSigner({ verify: vi.fn(() => ok(superAdminClaims)) }) })
    const { context, request } = buildContext({ authorization: 'Bearer valid-token' })

    // Ни одна проверка тенанта не должна сработать — TenantContext намеренно НЕ установлен.
    const store = await runWithRequestContext(() => guard.canActivate(context))

    expect(request.authClaims).toEqual(superAdminClaims)
    expect(store.userId).toBe(superAdminClaims.sub)
    expect(store.role).toBe('super_admin')
  })

  it('DTJ-443 — сессия токена отозвана → 401 TOKEN_INVALID, claims не проставляются', async () => {
    const sessionStatus = buildSessionStatus(true)
    const { context, request } = buildContext({ authorization: 'Bearer valid-token' })

    await expect(inTenant('tenant-1', () => buildGuard({ sessionStatus }).canActivate(context))).rejects.toMatchObject({
      response: { code: 'TOKEN_INVALID' },
    })
    expect(sessionStatus.isRevoked).toHaveBeenCalledWith(CLAIMS.sessionId)
    expect(request.authClaims).toBeUndefined()
  })
})
