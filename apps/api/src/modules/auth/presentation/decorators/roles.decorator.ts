/**
 * `@Roles(...)` (EP-01, DTJ-022) — маркер маршрута с минимальным набором ролей.
 *
 * Контракт SRS-API-036: `RolesGuard` сверяет `claims.role` со списком из
 * декоратора. Если роль не входит — `403 INSUFFICIENT_ROLE`. Условная
 * авторизация (ownership, tenancy scope) — в `application/policies/`, НЕ
 * в `RolesGuard` (см. JSDoc guard'а).
 */
import { SetMetadata } from '@nestjs/common'
import { type UserRole } from '@dorutj/contracts'

export const ROLES_METADATA_KEY = Symbol.for('@dorutj/auth/roles')

export const Roles = (...roles: readonly UserRole[]): MethodDecorator & ClassDecorator => {
  return SetMetadata(ROLES_METADATA_KEY, roles)
}
