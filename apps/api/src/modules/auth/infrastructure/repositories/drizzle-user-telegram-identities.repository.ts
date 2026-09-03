/**
 * Drizzle `UserTelegramIdentitiesRepository` (EP-01, DTJ-027, волна 5 блок A).
 *
 * Подключается вместо `InMemoryUserTelegramIdentitiesRepository`, когда
 * доступна Postgres. `create` — find-or-create через `INSERT ... ON CONFLICT
 * DO NOTHING RETURNING *` + `SELECT` (тот же приём, что
 * `DrizzleUsersRepository.findOrCreateByTenantAndPhone`), опираясь на UNIQUE
 * `unique_telegram_user_per_tenant (tenant_id, telegram_user_id)`: конфликт
 * → строка уже существует (гонка двух одновременных Telegram-логинов одним
 * `telegram_user_id`) → возвращаем через `findByTenantAndTelegramId`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { userTelegramIdentities, type UserTelegramIdentityRow } from '@/db/schema/user-telegram-identities.js'
import {
  USER_TELEGRAM_IDENTITIES_REPOSITORY,
  type CreateUserTelegramIdentityInput,
  type UserTelegramIdentitiesRepository,
  type UserTelegramIdentity,
} from '@/modules/auth/application/ports/user-telegram-identities.repository.port.js'
import { type UnitOfWorkTx } from '@/modules/auth/application/ports/unit-of-work.port.js'
import { resolveDrizzleClient } from './drizzle-tx.util.js'

@Injectable()
export class DrizzleUserTelegramIdentitiesRepository implements UserTelegramIdentitiesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findByTenantAndTelegramId(
    tenantId: string,
    telegramUserId: bigint,
    tx?: UnitOfWorkTx,
  ): Promise<UserTelegramIdentity | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select()
      .from(userTelegramIdentities)
      .where(
        and(
          eq(userTelegramIdentities.tenantId, tenantId),
          eq(userTelegramIdentities.telegramUserId, telegramUserId),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : rowToDomain(row)
  }

  async create(
    input: CreateUserTelegramIdentityInput,
    tx?: UnitOfWorkTx,
  ): Promise<UserTelegramIdentity> {
    const client = resolveDrizzleClient(this.db, tx)
    const inserted = await client
      .insert(userTelegramIdentities)
      .values({
        userId: input.userId,
        tenantId: input.tenantId,
        telegramUserId: input.telegramUserId,
      })
      .onConflictDoNothing()
      .returning()
    if (inserted.length > 0) {
      const insertedRow = inserted[0]
      if (insertedRow === undefined) {
        throw new Error('user_telegram_identities: empty insert with length>0')
      }
      return rowToDomain(insertedRow)
    }
    const existing = await this.findByTenantAndTelegramId(input.tenantId, input.telegramUserId, tx)
    if (existing === null) {
      throw new Error(
        `user_telegram_identities: race after conflict for ${input.tenantId}|${input.telegramUserId.toString()}`,
      )
    }
    return existing
  }
}

function rowToDomain(row: UserTelegramIdentityRow): UserTelegramIdentity {
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    telegramUserId: row.telegramUserId,
  }
}

export { USER_TELEGRAM_IDENTITIES_REPOSITORY }
