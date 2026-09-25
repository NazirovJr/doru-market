// Опциональная аутентификация: гость (нет Authorization) допустим, присутствующий Bearer
// верифицируется как AuthGuard/CartIdentityGuard (дублирование той же verify-логики намеренно —
// два guard'а с разной семантикой обязательности не собрать без ветвления).
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { ErrorCode } from '@dorutj/contracts'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { TenantContext } from '@/common/context/tenant-context.js'

interface AnalyticsEventsRequest {
  readonly headers: Record<string, string | string[] | undefined>
  analyticsUserId?: string | null
}

@Injectable()
export class AnalyticsEventsIdentityGuard implements CanActivate {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` (DTJ-001).
  constructor(@Inject(JWT_SIGNER) private readonly jwtSigner: JwtSignerPort) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AnalyticsEventsRequest>()
    const authHeader = request.headers.authorization
    if (typeof authHeader !== 'string' || authHeader.length === 0) {
      request.analyticsUserId = null
      return true
    }
    request.analyticsUserId = this.verifyBearer(authHeader)
    return true
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
