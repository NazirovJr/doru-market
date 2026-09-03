/**
 * `CartIdentityGuard` (EP-09, DTJ-226, SRS-API-024/036/045, D-EP09-23) — резолвит, кто
 * обращается к корзине: аутентифицированный `customer` (Bearer JWT) ИЛИ гость по
 * `X-Cart-Session-Token`. НИКОГДА не блокирует запрос — `CartController` публичный
 * (`@Public()`), гость имеет право на корзину без логина (SRS-ORD-002/tz.log). Результат
 * кладётся в `request.cartIdentity`, читается декоратором `@CartIdentity()`.
 *
 * НЕ переиспользует `AuthGuard` (EP-01) напрямую — `AuthGuard` бросает `401 UNAUTHENTICATED`
 * при ОТСУТСТВИИ заголовка `Authorization` (правильно для маршрутов, где аутентификация
 * ОБЯЗАТЕЛЬНА), а здесь отсутствие заголовка — штатный гостевой путь, не ошибка. Верификация
 * ПРИСУТСТВУЮЩЕГО Bearer-токена (подпись/`exp`/cross-tenant) — дословно та же логика, что
 * `AuthGuard.verifyAndAttach`/`assertCrossTenantAccess` (`@/modules/auth/presentation/guards/
 * auth.guard.ts`), продублирована здесь намеренно: два guard'а с генuinely разной семантикой
 * («обязательно» vs «опционально») из одного `canActivate` не собрать без ветвления, которое
 * само по себе не короче копии. `JWT_SIGNER`/`JwtClaims` — импорт ТОЛЬКО через публичный
 * барабан `modules/auth/index.js` (D-27, `no-cross-module-deep-import`), не из
 * `application/ports/...` этого чужого модуля напрямую.
 *
 * ПРИСУТСТВУЮЩИЙ, но НЕВАЛИДНЫЙ/просроченный Bearer — это НЕ тихий фолбэк на гостя (было бы
 * сюрпризом: клиент, чья сессия истекла, увидел бы ЧУЖУЮ для себя гостевую корзину вместо
 * ожидаемой ошибки) — бросает `401`, ровно как `AuthGuard`.
 *
 * `X-Cart-Session-Token` — bearer-СЕКРЕТ (D-EP09-23): читается ТОЛЬКО из заголовка, никогда
 * из query/URL (SRS-требование по PII в query-строке); не логируется целиком —
 * `common/logging/root-logger.ts` несёт этот заголовок в `REDACTED_PATHS`. Guard НЕ
 * ВАЛИДИРУЕТ владение — только формат (непустая строка ≤128 символов, предел колонки
 * `cart.session_token VARCHAR(128)`, DTJ-220 DDL). Фактический резолв/создание —
 * `ResolveOrCreateCartUseCase`: КЛИЕНТСКОЕ значение заголовка используется ТОЛЬКО для поиска
 * УЖЕ существующей корзины — use case НИКОГДА не создаёт строку `cart` под значением, пришедшим
 * от клиента (правка приёмки CTO, устраняет session fixation — предыдущая редакция этого
 * абзаца заявляла обратное, хотя guard проверял только формат, а не факт серверной выдачи:
 * клиент, приславший короткое/угаданное значение, мог «застолбить» под ним корзину). Если под
 * предъявленным значением корзины нет, `ResolveOrCreateCartUseCase` генерирует НОВЫЙ
 * `crypto.randomBytes`-токен и создаёт корзину под ним, а клиентское значение отбрасывает —
 * именно поэтому подбор чужой корзины перебором заголовка невозможен: КАЖДОЕ значение, реально
 * сохранённое в `cart.session_token`, выдано ТОЛЬКО сервером (см. JSDoc use case'а).
 */
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { ErrorCode } from '@dorutj/contracts'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import type { CartIdentity } from '@/modules/orders/application/cart/resolve-or-create-cart.use-case.js'

const SESSION_TOKEN_HEADER = 'x-cart-session-token'
/** DTJ-220 DDL: `cart.session_token VARCHAR(128)` — верхняя граница формата, не проверка владения. */
const MAX_SESSION_TOKEN_LENGTH = 128

interface CartIdentityRequest {
  readonly headers: Record<string, string | string[] | undefined>
  cartIdentity?: CartIdentity
}

@Injectable()
export class CartIdentityGuard implements CanActivate {
  // Явный @Inject: esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
  constructor(@Inject(JWT_SIGNER) private readonly jwtSigner: JwtSignerPort) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CartIdentityRequest>()
    request.cartIdentity = this.resolveIdentity(request)
    return true
  }

  private resolveIdentity(request: CartIdentityRequest): CartIdentity {
    const authHeader = request.headers.authorization
    if (typeof authHeader === 'string' && authHeader.length > 0) {
      return { customerId: this.verifyBearer(authHeader), sessionToken: null }
    }
    return { customerId: null, sessionToken: normalizeSessionToken(request.headers[SESSION_TOKEN_HEADER]) }
  }

  private verifyBearer(authHeader: string): string {
    const [scheme, token] = authHeader.split(' ')
    if (scheme !== 'Bearer' || token === undefined || token === '') {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'invalid Authorization scheme (expected "Bearer <token>")',
      })
    }
    const result = this.jwtSigner.verify(token)
    if (!result.ok) {
      const code = result.error.code === 'TOKEN_EXPIRED' ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID
      throw new UnauthorizedException({ code, message: result.error.message })
    }
    this.assertCrossTenantAccess(result.value)
    return result.value.sub
  }

  /** 1:1 с `AuthGuard.assertCrossTenantAccess` (см. JSDoc файла — намеренное дублирование). */
  private assertCrossTenantAccess(claims: JwtClaims): void {
    const isSuperAdmin = claims.role === 'super_admin'
    if (isSuperAdmin || claims.tenantId === null) {
      return
    }
    const tenantStore = TenantContext.get()
    if (tenantStore === undefined) {
      throw new UnauthorizedException({ code: ErrorCode.INTERNAL_ERROR, message: 'tenant context not initialized' })
    }
    if (tenantStore.unresolved) {
      throw new UnauthorizedException({ code: ErrorCode.TENANT_NOT_RESOLVED, message: 'tenant not resolved' })
    }
    if (claims.tenantId !== tenantStore.tenantId) {
      throw new UnauthorizedException({ code: ErrorCode.CROSS_TENANT_ACCESS_DENIED, message: 'cross-tenant access denied' })
    }
  }
}

function normalizeSessionToken(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SESSION_TOKEN_LENGTH) {
    return null
  }
  return value
}

export { SESSION_TOKEN_HEADER }
