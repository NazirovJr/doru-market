/**
 * Drizzle-схема `user_telegram_identities` (EP-01, DTJ-027, SRS-API-031).
 *
 * Назначение — связь (M:1) между Telegram-пользователем (по `telegram_user_id`,
 * BIGINT) и нашим `users.id` в конкретном тенанте. Это АЛЬТЕРНАТИВНЫЙ
 * канал идентификации наряду с phone-based login (DTJ-022/023/024).
 *
 * Поля:
 *   - `id`              — UUID v7, PK (default на уровне БД, `IdGeneratorPort`
 *                         для прикладного кода, DTJ-006).
 *   - `user_id`         — UUID, NOT NULL, FK на `users(id)` ON DELETE CASCADE
 *                         (GDPR: при удалении пользователя удаляются все его
 *                         внешние identity-привязки, SRS-DB-004).
 *   - `telegram_user_id` — BIGINT, NOT NULL, ID пользователя в Telegram
 *                         (Telegram выдаёт 64-bit числа, выходят за int4).
 *   - `tenant_id`       — UUID, NOT NULL. FK на `tenants(id)` отложен (EP-02).
 *
 * Constraints:
 *   - UNIQUE (`tenant_id`, `telegram_user_id`) — один Telegram-юзер = один
 *     аккаунт в нашей системе в данном тенанте. White-Label (R3) позволяет
 *     создать НЕЗАВИСИМЫЕ аккаунты с тем же `telegram_user_id` в РАЗНЫХ
 *     тенантах (тот же `telegram_user_id` живёт в разных наших БД).
 *
 * Hot-path:
 *   - find by (tenant_id, telegram_user_id) на каждом `POST /auth/telegram`
 *     (DTJ-027 §3.9). UNIQUE-индекс = 1 lookup, O(log n).
 *
 * @see tickets/ep01-foundation/DTJ-027.md
 */
import { sql } from 'drizzle-orm'
import { bigint, pgTable, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from './users.js'

export const USER_TELEGRAM_IDENTITIES_TABLE = 'user_telegram_identities'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на
// новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем).
 
export const userTelegramIdentities = pgTable(
  USER_TELEGRAM_IDENTITIES_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // FK → users(id) — таблица существует на момент этого тикета (DTJ-014).
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }).notNull(),
    // FK → tenants(id) — отложен (EP-02, DTJ-052), эволюционная миграция.
    tenantId: uuid('tenant_id').notNull(),
  },
  (table) => [
    unique('unique_telegram_user_per_tenant').on(table.tenantId, table.telegramUserId),
  ],
)

export type UserTelegramIdentityRow = typeof userTelegramIdentities.$inferSelect
export type UserTelegramIdentityInsert = typeof userTelegramIdentities.$inferInsert
