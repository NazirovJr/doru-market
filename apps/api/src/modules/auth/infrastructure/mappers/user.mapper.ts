/**
 * `UserMapper` (EP-01, DTJ-022) — маппинг `UserRow` (Drizzle) → доменный `User`.
 *
 * Преобразования:
 *   - `role` (varchar) → строгий `UserRole` (если БД содержит значение вне
 *     `USER_ROLES` — привести к `'customer'` как безопасному дефолту; это
 *     указывает на повреждение данных и должно расследоваться, но в runtime
 *     мы не падаем — DTJ-022 §«Риски»)
 *   - `telegramChatId` (`bigint`) → `bigint` (в JS тип `bigint`, не `number`)
 *   - `createdAt` / `deletedAt` (`Date | string | null` после Drizzle-десериализации) →
 *     `Date` / `Date | null`
 */
import { USER_ROLES, type UserRole } from '@dorutj/contracts'
import { type UserRow } from '@/db/schema/users.js'
import { type User } from '@/modules/auth/domain/user.js'

export function userRowToDomain(row: UserRow): User {
  return {
    id: row.id,
    tenantId: row.tenantId,
    phoneNumber: row.phoneNumber,
    role: toUserRole(row.role),
    fullName: row.fullName,
    pharmacyId: row.pharmacyId,
    chainId: row.chainId,
    telegramChatId: row.telegramChatId,
    preferredLocale: row.preferredLocale,
    isActive: row.isActive,
    createdAt: toDateOrNull(row.createdAt) ?? new Date(0),
    deletedAt: toDateOrNull(row.deletedAt),
  }
}

function toUserRole(raw: string): UserRole {
  return (USER_ROLES as readonly string[]).includes(raw) ? (raw as UserRole) : 'customer'
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null
  }
  return value instanceof Date ? value : new Date(value)
}
