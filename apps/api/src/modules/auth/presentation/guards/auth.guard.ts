/**
 * `AuthGuard` (EP-01, DTJ-022) — проверка JWT на каждом защищённом маршруте.
 *
 * Контракт (SRS-API-024/036/045/067):
 *   1. Endpoint помечен `@Public()` — guard пропускает без проверки.
 *   2. Нет заголовка `Authorization: Bearer <JWT>` (без `@Public()`) →
 *      `401 UNAUTHENTICATED`.
 *   3. `JwtSignerPort.verify` → `TOKEN_EXPIRED` → `401 TOKEN_EXPIRED`.
 *   4. `JwtSignerPort.verify` → `TOKEN_INVALID` / `INVALID_SIGNATURE` →
 *      `401 TOKEN_INVALID`.
 *   5. Cross-tenant check: `claims.tenantId === resolvedTenantId` (SRS-API-045).
 *      `super_admin` (tenantId === null) исключён — может работать межтенантно.
 *      Несовпадение → `403 CROSS_TENANT_ACCESS_DENIED`.
 *   6. Успех — заполняет `request['authClaims']` (для `@CurrentUser()`) и
 *      пробрасывает в `RequestContext` через DI-плагин (DTJ-001 §«RequestContext»).
 *
 * RBAC (роль) проверяет `RolesGuard` ПОСЛЕ `AuthGuard` (`@UseGuards(AuthGuard,
 * RolesGuard)`). Здесь — только «аутентифицирован ли пользователь» + cross-tenant.
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ErrorCode } from '@dorutj/contracts'
import { PUBLIC_METADATA_KEY } from '@/common/decorators/public.decorator.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { RequestContext } from '@/common/context/request-context.js'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/application/ports/jwt-signer.port.js'

@Injectable()
export class AuthGuard implements CanActivate {
  // Явный @Inject на обоих параметрах: esbuild (vitest) не эмитит `design:paramtypes`
  // (см. DTJ-001, тот же приём, что и в `HealthController`) — `reflector` резолвился
  // как `undefined` под тестовым рантаймом; `jwtSigner` — интерфейс порта, для него
  // `@Inject(JWT_SIGNER)` обязателен в принципе (порты — это только тип на этапе
  // компиляции, без токена Nest не знает, что подставить).
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JWT_SIGNER) private readonly jwtSigner: JwtSignerPort,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) {
      return true
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>
      authClaims?: JwtClaims
    }>()
    const authHeader = request.headers.authorization
    if (authHeader === undefined || typeof authHeader !== 'string') {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'missing Authorization header',
      })
    }
    const [scheme, token] = authHeader.split(' ')
    if (scheme !== 'Bearer' || token === undefined || token === '') {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'invalid Authorization scheme (expected "Bearer <token>")',
      })
    }
    return this.verifyAndAttach(request, token)
  }

  private verifyAndAttach(
    request: { authClaims?: JwtClaims },
    token: string,
  ): boolean {
    const result = this.jwtSigner.verify(token)
    if (!result.ok) {
      const code = result.error.code
      if (code === 'TOKEN_EXPIRED') {
        throw new UnauthorizedException({
          code: ErrorCode.TOKEN_EXPIRED,
          message: 'access token expired',
        })
      }
      throw new UnauthorizedException({
        code: ErrorCode.TOKEN_INVALID,
        message: result.error.message,
      })
    }

    const claims = result.value

    this.assertCrossTenantAccess(claims)

    // eslint-disable-next-line no-param-reassign -- request — это объект, выданный Fastify, прямая мутация отражения claims (SRS-API-024); переписывать через return невозможно, т.к. контракт canActivate — boolean.
    request.authClaims = claims
    // foundIssue (DTJ-233, обнаружено живым прогоном): JSDoc файла с момента DTJ-022 обещал
    // «пробрасывает в RequestContext через DI-плагин», но код никогда не вызывал
    // `RequestContext.patch(...)` — `RequestContextStore.userId`/`role` оставались `null`
    // НАВСЕГДА для ЛЮБОГО аутентифицированного запроса. Не замечено ни одним потребителем ДО
    // этого тикета: первый реальный consumer, читающий `RequestContext.userId` — фолбэк
    // `IdempotencyInterceptor.readUserId()` (`common/idempotency/idempotency.interceptor.ts`,
    // используется, когда `req.user` не заполнен — а `req.user` не заполняет вообще никто в
    // проекте, только `req.authClaims`) — до сих пор `@Idempotent()` НИ РАЗУ не комбинировался с
    // `AuthGuard` ни в одном контроллере (первый — `CheckoutController`, DTJ-233), поэтому дефект
    // был недостижим. Живой прогон против `POST /api/v1/orders` с валидным JWT + валидным
    // `Idempotency-Key` давал `401 UNAUTHENTICATED` («Cannot resolve userId… no auth context»)
    // ДО этой правки — воспроизведено, не домыслено. Дописывает ровно то, что JSDoc уже обещал.
    RequestContext.patch({ userId: claims.sub, role: claims.role })
    return true
  }

  /**
   * Cross-tenant check (SRS-API-045): token.tenantId must match resolved tenant.
   * super_admin (tenantId === null) is exempt — can operate cross-tenant.
   * Throws UnauthorizedException with CROSS_TENANT_ACCESS_DENIED on mismatch.
   */
  private assertCrossTenantAccess(claims: JwtClaims): void {
    const isSuperAdmin = claims.role === 'super_admin'
    if (isSuperAdmin || claims.tenantId === null) {
      return
    }
    const tenantStore = TenantContext.get()
    // TenantContext should be initialized by TenantResolutionMiddleware.
    // If not, it's an architectural defect (500), not a cross-tenant issue.
    if (tenantStore === undefined) {
      throw new UnauthorizedException({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'tenant context not initialized (middleware not registered)',
      })
    }
    if (tenantStore.unresolved) {
      // Should have been caught by TenantScopeGuard, but defensive check.
      throw new UnauthorizedException({
        code: ErrorCode.TENANT_NOT_RESOLVED,
        message: 'tenant not resolved',
      })
    }
    const resolvedTenantId = tenantStore.tenantId
    if (claims.tenantId !== resolvedTenantId) {
      throw new UnauthorizedException({
        code: ErrorCode.CROSS_TENANT_ACCESS_DENIED,
        message: 'cross-tenant access denied',
      })
    }
  }
}
