/**
 * Drizzle `UsersRepository` (EP-01, DTJ-022, DTJ-024).
 *
 * Подключается вместо `InMemoryUsersRepository`, когда доступна Postgres
 * (production / docker-compose). Использует `DRIZZLE_DB` symbol — общий
 * `DrizzleDatabase` тип, экспортируемый `drizzleProvider`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { users } from '@/db/schema/users.js'
import { userRowToDomain } from '@/modules/auth/infrastructure/mappers/user.mapper.js'
import {
  USERS_REPOSITORY,
  type CreateUserInput,
  type UpdateUserPatch,
  type UsersRepository,
} from '@/modules/auth/application/ports/users.repository.port.js'
import { type User } from '@/modules/auth/domain/user.js'

@Injectable()
export class DrizzleUsersRepository implements UsersRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findByTenantAndPhone(tenantId: string, phoneNumber: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.phoneNumber, phoneNumber),
          isNull(users.deletedAt),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (row === undefined) {
      return Promise.resolve(null)
    }
    return Promise.resolve(userRowToDomain(row))
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) {
      return Promise.resolve(null)
    }
    return Promise.resolve(userRowToDomain(row))
  }

  /**
   * [Task 5, handoff §6] Глобальный поиск по phone — см. JSDoc в port.
   * Используется только в VerifyOtpUseCase для логина (после успешной
   * verify-OTP, когда пользователь уже «предъявил» identity через код).
   * Нарушает обычную tenant-isolation, но оправдан фактом владения
   * одноразовым OTP-кодом (DTJ-024). Без этого метода pharmacist, созданный
   * в TENANT_ID через /staff-accounts, не находился бы при логине — verify
   * видел бы только `tenantId='neutral'` placeholder из контроллера.
   */
  async findActiveByPhone(phoneNumber: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.phoneNumber, phoneNumber), isNull(users.deletedAt)))
      .orderBy(users.createdAt)
      .limit(1)
    const row = rows[0]
    if (row === undefined) {
      return Promise.resolve(null)
    }
    return Promise.resolve(userRowToDomain(row))
  }

  async create(input: CreateUserInput): Promise<User> {
    const rows = await this.db
      .insert(users)
      .values({
        tenantId: input.tenantId,
        phoneNumber: input.phoneNumber,
        role: input.role,
        fullName: input.fullName,
        // [DTJ-030] `pharmacyId`/`chainId` пробрасываются из входа. Дефолт `null`
        // сохранён для обратной совместимости (VerifyOtpUseCase/TelegramAuthUseCase
        // всегда передают null).
        pharmacyId: input.pharmacyId ?? null,
        chainId: input.chainId ?? null,
      })
      .returning()
    const row = rows[0]
    if (row === undefined) {
      throw new Error('users insert returned no rows')
    }
    return Promise.resolve(userRowToDomain(row))
  }

  /**
   * Атомарный find-or-create (DTJ-024). Использует partial unique index
   * (DTJ-014 `ux_users_tenant_phone_active`) — `INSERT ... ON CONFLICT
   * DO NOTHING RETURNING *` + `SELECT`, чтобы избежать гонки двух
   * одновременных входов с одного номера. Конфликт → строка уже
   * существует → возвращаем через `findByTenantAndPhone`.
   */
  async findOrCreateByTenantAndPhone(input: CreateUserInput): Promise<User> {
    const inserted = await this.db
      .insert(users)
      .values({
        tenantId: input.tenantId,
        phoneNumber: input.phoneNumber,
        role: input.role,
        fullName: input.fullName,
        pharmacyId: input.pharmacyId ?? null,
        chainId: input.chainId ?? null,
      })
      .onConflictDoNothing()
      .returning()
    if (inserted.length > 0) {
      const insertedRow = inserted[0]
      if (insertedRow === undefined) {
        throw new Error('findOrCreateByTenantAndPhone: empty insert with length>0')
      }
      return Promise.resolve(userRowToDomain(insertedRow))
    }
    const existing = await this.findByTenantAndPhone(input.tenantId, input.phoneNumber ?? '')
    if (existing === null) {
      throw new Error(`findOrCreateByTenantAndPhone: race after conflict for ${input.tenantId}|${String(input.phoneNumber)}`)
    }
    return existing
  }

  async update(id: string, patch: UpdateUserPatch): Promise<User> {
    const rows = await this.db
      .update(users)
      .set({
        fullName: patch.fullName,
        preferredLocale: patch.preferredLocale ?? undefined,
        telegramChatId: patch.telegramChatId,
      })
      .where(eq(users.id, id))
      .returning()
    const row = rows[0]
    if (row === undefined) {
      throw new Error(`user not found for update: ${id}`)
    }
    return Promise.resolve(userRowToDomain(row))
  }
}

export { USERS_REPOSITORY }
