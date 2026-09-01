/**
 * `UserTelegramIdentitiesRepository` (EP-01, DTJ-027, SRS-API-031 шаг 9) —
 * порт для таблицы `user_telegram_identities`. Связывает Telegram
 * `telegram_user_id` с нашим `users.id` в данном тенанте.
 *
 * Контракт:
 *   - `findByTenantAndTelegramId(tenantId, telegramUserId, tx?)` — find-or-create
 *     предпосылка. `tx` — Drizzle-ready, для hot-path R1 не нужен.
 *   - `create(input, tx?)` — создание связи (идемпотентность — на стороне БД
 *     UNIQUE-индекс, Drizzle-реализация ловит 23505).
 *   - `findByUserId(userId, tx?)` — обратный lookup (нужен для `GET
 *     /users/me/telegram-accounts` в EP-15 admin, не в R1; оставлен в
 *     контракте для предотвращения регрессии).
 *
 * `tx: DrizzleDb` опциональный — find используется как «проверить перед
 * insert». В R1 InMemory-режим это Map; в Drizzle-режиме — `db.transaction`.
 */
import { type UnitOfWorkTx } from './unit-of-work.port.js'

export const USER_TELEGRAM_IDENTITIES_REPOSITORY = Symbol.for(
  '@dorutj/auth/user-telegram-identities-repository',
)

export interface UserTelegramIdentity {
  readonly id: string
  readonly userId: string
  readonly tenantId: string
  readonly telegramUserId: bigint
}

export interface CreateUserTelegramIdentityInput {
  readonly userId: string
  readonly tenantId: string
  readonly telegramUserId: bigint
}

export interface UserTelegramIdentitiesRepository {
  findByTenantAndTelegramId(
    tenantId: string,
    telegramUserId: bigint,
    tx?: UnitOfWorkTx,
  ): Promise<UserTelegramIdentity | null>
  create(input: CreateUserTelegramIdentityInput, tx?: UnitOfWorkTx): Promise<UserTelegramIdentity>
}
