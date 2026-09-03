import { UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { ok, err } from '@dorutj/domain-kernel'
import type { JwtClaims, JwtSignerPort } from '@/modules/auth/index.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { CartIdentityGuard } from './cart-identity.guard.js'

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
  request: { headers: typeof headers; cartIdentity?: unknown }
} {
  const request: { headers: typeof headers; cartIdentity?: unknown } = { headers }
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
  return { context, request }
}

function buildJwtSigner(overrides: Partial<JwtSignerPort> = {}): JwtSignerPort {
  return {
    sign: vi.fn(() => 'token'),
    verify: vi.fn(() => ok(CLAIMS)),
    ...overrides,
  }
}

describe('CartIdentityGuard (DTJ-226, SRS-API-024/036/045)', () => {
  it('без Authorization и без X-Cart-Session-Token — гость с sessionToken=null (НЕ бросает)', () => {
    const guard = new CartIdentityGuard(buildJwtSigner())
    const { context, request } = buildContext({})

    expect(guard.canActivate(context)).toBe(true)
    expect(request.cartIdentity).toEqual({ customerId: null, sessionToken: null })
  })

  it('X-Cart-Session-Token присутствует (без Authorization) — гость с этим sessionToken', () => {
    const guard = new CartIdentityGuard(buildJwtSigner())
    const { context, request } = buildContext({ 'x-cart-session-token': 'guest-token-abc' })

    guard.canActivate(context)

    expect(request.cartIdentity).toEqual({ customerId: null, sessionToken: 'guest-token-abc' })
  })

  it('X-Cart-Session-Token длиннее 128 символов — трактуется как отсутствующий (формат)', () => {
    const guard = new CartIdentityGuard(buildJwtSigner())
    const { context, request } = buildContext({ 'x-cart-session-token': 'x'.repeat(129) })

    guard.canActivate(context)

    expect(request.cartIdentity).toEqual({ customerId: null, sessionToken: null })
  })

  it('валидный Bearer — customerId из claims.sub, sessionToken=null (в своём тенанте)', () => {
    const guard = new CartIdentityGuard(buildJwtSigner())
    const { context, request } = buildContext({ authorization: 'Bearer valid-token' })

    TenantContext.run(TenantContext.forTenant({ tenantId: 'tenant-1', slug: 's', chainId: null, isNeutral: false }), () => {
      guard.canActivate(context)
    })

    expect(request.cartIdentity).toEqual({ customerId: 'customer-1', sessionToken: null })
  })

  it('невалидная схема заголовка (не "Bearer <token>") — 401 UNAUTHENTICATED', () => {
    const guard = new CartIdentityGuard(buildJwtSigner())
    const { context } = buildContext({ authorization: 'Basic xyz' })

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('просроченный Bearer — 401 TOKEN_EXPIRED (НЕ тихий фолбэк на гостя)', () => {
    const jwtSigner = buildJwtSigner({
      verify: vi.fn(() => err({ code: 'TOKEN_EXPIRED' as const, message: 'expired', name: 'JwtVerificationError' } as never)),
    })
    const guard = new CartIdentityGuard(jwtSigner)
    const { context } = buildContext({ authorization: 'Bearer expired-token' })

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('cross-tenant: claims.tenantId не совпадает с резолвленным — 401/CROSS_TENANT_ACCESS_DENIED', () => {
    const guard = new CartIdentityGuard(buildJwtSigner())
    const { context } = buildContext({ authorization: 'Bearer valid-token' })

    expect(() =>
      TenantContext.run(TenantContext.forTenant({ tenantId: 'tenant-OTHER', slug: 's', chainId: null, isNeutral: false }), () =>
        guard.canActivate(context),
      ),
    ).toThrow(UnauthorizedException)
  })

  it('super_admin (tenantId claims=null) — cross-tenant проверка пропускается', () => {
    const superAdminClaims: JwtClaims = { ...CLAIMS, role: 'super_admin', tenantId: null }
    const guard = new CartIdentityGuard(buildJwtSigner({ verify: vi.fn(() => ok(superAdminClaims)) }))
    const { context, request } = buildContext({ authorization: 'Bearer admin-token' })

    expect(guard.canActivate(context)).toBe(true)
    expect(request.cartIdentity).toEqual({ customerId: 'customer-1', sessionToken: null })
  })
})
