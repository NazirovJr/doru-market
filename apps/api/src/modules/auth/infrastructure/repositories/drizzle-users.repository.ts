/**
 * Drizzle `UsersRepository` (EP-01, DTJ-022, DTJ-024).
 *
 * Подключается вместо `InMemoryUsersRepository`, когда доступна Postgres
 * (production / docker-compose). Использует `DRIZZLE_DB` symbol — общий
 * `DrizzleDatabase` тип, экспортируемый `drizzleProvider`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, ilike, isNull, lt, or, type SQL } from 'drizzle-orm'
import { type UserRole } from '@dorutj/contracts'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { users } from '@/db/schema/users.js'
import { userRowToDomain } from '@/modules/auth/infrastructure/mappers/user.mapper.js'
import {
  USERS_REPOSITORY,
  type CreateUserInput,
  type UpdateUserPatch,
  type UsersListCursor,
  type UsersListPage,
  type UsersListQuery,
  type UsersRepository,
} from '@/modules/auth/application/ports/users.repository.port.js'
import { type UnitOfWorkTx } from '@/modules/auth/application/ports/unit-of-work.port.js'
import { type User } from '@/modules/auth/domain/user.js'
import { resolveDrizzleClient } from './drizzle-tx.util.js'

@Injectable()
export class DrizzleUsersRepository implements UsersRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findByTenantAndPhone(tenantId: string, phoneNumber: string, tx?: UnitOfWorkTx): Promise<User | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
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

  async findById(id: string, tx?: UnitOfWorkTx): Promise<User | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
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
  async findActiveByPhone(phoneNumber: string, tx?: UnitOfWorkTx): Promise<User | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
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

  async create(input: CreateUserInput, tx?: UnitOfWorkTx): Promise<User> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
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
  async findOrCreateByTenantAndPhone(input: CreateUserInput, tx?: UnitOfWorkTx): Promise<User> {
    const client = resolveDrizzleClient(this.db, tx)
    const inserted = await client
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
    const existing = await this.findByTenantAndPhone(input.tenantId, input.phoneNumber ?? '', tx)
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

  /** [DTJ-354] Кросс-тенантный курсорный список (`super_admin`). */
  async list(query: UsersListQuery): Promise<UsersListPage> {
    const conditions = buildListConditions(query)
    const rows = await this.db
      .select()
      .from(users)
      .where(and(...conditions))
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(query.limit + 1)
    const hasMore = rows.length > query.limit
    const page = hasMore ? rows.slice(0, query.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(userRowToDomain),
      nextCursor: hasMore && last !== undefined ? { v: normalizeCreatedAt(last.createdAt).toISOString(), id: last.id } : null,
      hasMore,
    }
  }

  async setActive(id: string, isActive: boolean, tx?: UnitOfWorkTx): Promise<User | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .update(users)
      .set({ isActive })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning()
    const row = rows[0]
    return row === undefined ? null : userRowToDomain(row)
  }

  async setRole(id: string, role: UserRole, tx?: UnitOfWorkTx): Promise<User | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .update(users)
      .set({ role })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning()
    const row = rows[0]
    return row === undefined ? null : userRowToDomain(row)
  }
}

function keysetCondition(cursor: UsersListCursor): SQL | undefined {
  const anchorCreatedAt = new Date(cursor.v)
  return or(lt(users.createdAt, anchorCreatedAt), and(eq(users.createdAt, anchorCreatedAt), lt(users.id, cursor.id)))
}

/** Вынесено из `list()` — снижает цикломатическую сложность (C1). */
function buildListConditions(query: UsersListQuery): SQL[] {
  const conditions: SQL[] = [isNull(users.deletedAt)]
  if (query.filter.role !== undefined) conditions.push(eq(users.role, query.filter.role))
  if (query.filter.tenantId !== undefined) conditions.push(eq(users.tenantId, query.filter.tenantId))
  if (query.filter.phoneLike !== undefined) conditions.push(ilike(users.phoneNumber, `%${query.filter.phoneLike}%`))
  const cursorCondition = query.cursor != null ? keysetCondition(query.cursor) : undefined
  if (cursorCondition !== undefined) conditions.push(cursorCondition)
  return conditions
}

function normalizeCreatedAt(value: Date | string | null): Date {
  return value === null ? new Date(0) : new Date(value)
}

export { USERS_REPOSITORY }
