/**
 * `AuthGuard` — unit-набор (EP-01, DTJ-022; DTJ-233 добавляет регресс-покрытие
 * `RequestContext.patch` — до этого файла у guard'а НЕ было юнит-тестов вовсе). Фокус:
 * успешная аутентификация обязана заполнить И `request.authClaims` (`@CurrentUser()`), И
 * `RequestContext` (`userId`/`role`, foundIssue DTJ-233 — JSDoc файла обещал это с DTJ-022, код
 * не делал; см. JSDoc `auth.guard.ts`/`test/integration/orders/__tests__/test-app.ts`).
 */
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'
import { ok, err } from '@dorutj/domain-kernel'
import type { JwtClaims, JwtSignerPort } from '@/modules/auth/index.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { RequestContext, type RequestContextStore } from '@/common/context/request-context.js'
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

/** Требуется активный `RequestContext.run()`-скоуп — `patch()` вне него молча no-op'ает. */
function runWithRequestContext<T>(fn: () => T): { result: T; store: RequestContextStore } {
  const store: RequestContextStore = { requestId: 'req-1', tenantId: null, userId: null, role: null }
  const result = RequestContext.run(store, fn)
  return { result, store }
}

describe('AuthGuard (DTJ-022, foundIssue DTJ-233 — RequestContext.patch)', () => {
  it('@Public() — пропускает без проверки токена, request.authClaims не заполняется', () => {
    const guard = new AuthGuard(buildReflector(true), buildJwtSigner())
    const { context, request } = buildContext({})

    expect(guard.canActivate(context)).toBe(true)
    expect(request.authClaims).toBeUndefined()
  })

  it('нет заголовка Authorization — 401 UNAUTHENTICATED', () => {
    const guard = new AuthGuard(buildReflector(), buildJwtSigner())
    const { context } = buildContext({})

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('невалидная схема (не Bearer) — 401 UNAUTHENTICATED', () => {
    const guard = new AuthGuard(buildReflector(), buildJwtSigner())
    const { context } = buildContext({ authorization: 'Basic abc' })

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('JwtSignerPort.verify → TOKEN_EXPIRED — 401 TOKEN_EXPIRED', () => {
    const jwtSigner = buildJwtSigner({
      verify: vi.fn(() => err({ code: 'TOKEN_EXPIRED', message: 'expired', name: 'JwtVerificationError' } as never)),
    })
    const guard = new AuthGuard(buildReflector(), jwtSigner)
    const { context } = buildContext({ authorization: 'Bearer expired-token' })

    expect(() => {
      TenantContext.run(TenantContext.forTenant({ tenantId: 'tenant-1', slug: 's', chainId: null, isNeutral: false }), () =>
        guard.canActivate(context),
      )
    }).toThrow(UnauthorizedException)
  })

  it('валидный токен, тенант совпадает — заполняет request.authClaims (customer-роль, не super_admin)', () => {
    const guard = new AuthGuard(buildReflector(), buildJwtSigner())
    const { context, request } = buildContext({ authorization: 'Bearer valid-token' })

    TenantContext.run(TenantContext.forTenant({ tenantId: 'tenant-1', slug: 's', chainId: null, isNeutral: false }), () => {
      expect(guard.canActivate(context)).toBe(true)
    })

    expect(request.authClaims).toEqual(CLAIMS)
  })

  it('claims.tenantId ≠ резолвленный тенант — 403 CROSS_TENANT_ACCESS_DENIED (не super_admin)', () => {
    const guard = new AuthGuard(buildReflector(), buildJwtSigner())
    const { context } = buildContext({ authorization: 'Bearer valid-token' })

    expect(() => {
      TenantContext.run(TenantContext.forTenant({ tenantId: 'OTHER-tenant', slug: 's', chainId: null, isNeutral: false }), () =>
        guard.canActivate(context),
      )
    }).toThrow(UnauthorizedException)
  })

  it('foundIssue DTJ-233 — успешная аутентификация вызывает RequestContext.patch({userId, role}), а не оставляет их null', () => {
    const guard = new AuthGuard(buildReflector(), buildJwtSigner())
    const { context } = buildContext({ authorization: 'Bearer valid-token' })

    const { store } = runWithRequestContext(() => {
      TenantContext.run(TenantContext.forTenant({ tenantId: 'tenant-1', slug: 's', chainId: null, isNeutral: false }), () =>
        guard.canActivate(context),
      )
    })

    expect(store.userId).toBe(CLAIMS.sub)
    expect(store.role).toBe(CLAIMS.role)
  })

  it('super_admin (tenantId=null) — пропускает cross-tenant проверку, RequestContext.patch всё равно вызывается', () => {
    const superAdminClaims: JwtClaims = { ...CLAIMS, role: 'super_admin', tenantId: null }
    const guard = new AuthGuard(buildReflector(), buildJwtSigner({ verify: vi.fn(() => ok(superAdminClaims)) }))
    const { context, request } = buildContext({ authorization: 'Bearer valid-token' })

    const { store } = runWithRequestContext(() => {
      // Ни одна проверка тенанта не должна сработать — TenantContext намеренно НЕ установлен.
      expect(guard.canActivate(context)).toBe(true)
    })

    expect(request.authClaims).toEqual(superAdminClaims)
    expect(store.userId).toBe(superAdminClaims.sub)
    expect(store.role).toBe('super_admin')
  })
})
