/**
 * `RolesGuard` (EP-01, DTJ-022) — грубая проверка роли.
 *
 * Контракт SRS-API-036/039:
 *   - Если на маршруте НЕТ `@Roles(...)` И пользователь аутентифицирован —
 *     доступ разрешён ЛЮБОЙ роли (документированное поведение, чтобы декоратор
 *     был explicit opt-in). Безопасный дефолт: «требуем явный список ролей».
 *   - Если есть `@Roles(...)` и `claims.role` НЕ входит в список — `403
 *     INSUFFICIENT_ROLE`.
 *
 * **НЕ делает условных проверок** (ownership, tenancy scope) — это
 * ответственность `application/policies/*.policy.ts` конкретного модуля
 * (см. DTJ-022 §«Риски»).
 *
 * Зависит от `AuthGuard`: `claims` лежат в `request['authClaims']` после
 * `AuthGuard.canActivate`. Без `AuthGuard` в цепочке `@UseGuards(...)` —
 * `authClaims` не будет, и guard кинет `INTERNAL_ERROR` (500, явный
 * архитектурный дефект).
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type UserRole, ErrorCode } from '@dorutj/contracts'
import { ROLES_METADATA_KEY } from '@/modules/auth/presentation/decorators/roles.decorator.js'
import { type JwtClaims } from '@/modules/auth/application/ports/jwt-signer.port.js'

@Injectable()
export class RolesGuard implements CanActivate {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `HealthController`.
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<readonly UserRole[] | undefined>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (requiredRoles === undefined || requiredRoles.length === 0) {
      // Нет `@Roles(...)` на маршруте — пропускаем всех аутентифицированных
      // (явный безопасный дефолт: требуем явный список ролей для ограничения,
      // отсутствие декоратора = «без ограничения по роли»).
      return true
    }
    const request = context.switchToHttp().getRequest<{ authClaims?: JwtClaims }>()
    const claims = request.authClaims
    if (claims === undefined) {
      throw new ForbiddenException({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'RolesGuard used without prior AuthGuard (authClaims missing)',
      })
    }
    if (!requiredRoles.includes(claims.role)) {
      throw new ForbiddenException({
        code: ErrorCode.INSUFFICIENT_ROLE,
        message: `role "${claims.role}" is not in [${requiredRoles.join(', ')}]`,
      })
    }
    return true
  }
}
