/**
 * Drizzle-схема таблицы `users` (EP-01, DTJ-014/027).
 *
 * `users` — единая таблица идентичности для ВСЕХ 6 ролей (`customer`, `pharmacist`,
 * `pharmacy_admin`, `courier`, `support_agent`, `super_admin`).
 * Различие в guard/policy application-слоя, НЕ в схеме (SRS-API-017). Это
 * сознательное упрощение R1 — облегчает миграцию (роль — одна колонка, не 6 таблиц
 * с джойнами), сохраняет ссылочную целостность (любой `customer_id` в заказе
 * ссылается на ОДНУ таблицу) и совместимо с White-Label: один и тот же
 * `phone_number` — НЕЗАВИСИМЫЕ аккаунты в разных тенантах.
 *
 * **Отложенные FK** (см. §«Технический контекст» тикета): колонки
 * `tenantId`/`pharmacyId`/`chainId` созданы как `uuid` БЕЗ `.references(...)` —
 * целевые таблицы (`tenants` EP-02, `pharmacies`/`pharmacy_chains` EP-03) ещё не
 * существуют на момент этого тикета. EP-02/EP-03 добавляют
 * `ALTER TABLE users ADD CONSTRAINT ... FOREIGN KEY` своими эволюционными
 * миграциями (аналог `0015_deferred_fks.sql` из `11-database-schema.md`).
 *
 * **NULLABLE `phone_number`** (DTJ-027, миграция `0007_users_phone_nullable.sql`):
 * изначально `phone_number NOT NULL` (DTJ-014, OTP-только flow), но
 * `SRS-API-031` шаг 9 явно разрешает Telegram-путь БЕЗ телефона на момент
 * первого входа. Снятие `NOT NULL` — компромисс (см. DTJ-027 «Риски»):
 * альтернатива (отдельная таблица `telegram_only_users`) сложнее и нарушает
 * C15. `unique_phone_per_tenant` constraint по-прежнему работает корректно:
 * Postgres-стандарт — несколько строк с `phone_number = NULL` НЕ нарушают
 * UNIQUE-индекс (NULL ≠ NULL).
 *
 * SRS-DB-004: soft-delete через `deletedAt` (право на удаление ПДн).
 * SRS-DB-001: PK — `gen_random_uuid()` как фолбэк уровня БД, прикладной код
 * передаёт UUID v7 явно через `IdGeneratorPort` (DTJ-006).
 *
 * @see tickets/ep01-foundation/DTJ-014.md, DTJ-027.md
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  customType,
  pgTable,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/** Допустимые значения `role` (SRS-API-014). Соответствуют enum `user_role` в БД. */
export const USER_ROLE_VALUES = [
  'customer',
  'pharmacist',
  'pharmacy_admin',
  'courier',
  'support_agent',
  'super_admin',
] as const

export type UserRoleDb = (typeof USER_ROLE_VALUES)[number]

/**
 * Кастомный тип `timestamp with time zone` — общий для всех схем EP-01+
 * (см. `tenants.ts` §«CUSTOM_DOMAIN_STATUS_VALUES» — причина, почему
 * используем `customType`, а не `timestamp(...)`).
 */
const TIMESTAMPTZ = customType<{ data: Date; driverData: string }>({
  dataType() {
    return 'timestamp with time zone'
  },
})

export const USERS_TABLE = 'users'

export const users = pgTable(
  USERS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // FK → tenants(id) добавляется EP-02 (DTJ-052) эволюционной миграцией.
    tenantId: uuid('tenant_id').notNull(),
    // [DTJ-027] NULLABLE: Telegram-путь первого входа (без телефона).
    phoneNumber: varchar('phone_number', { length: 20 }),
    role: varchar('role', { length: 32 }).notNull().default('customer'),
    fullName: varchar('full_name', { length: 255 }),
    // FK → pharmacies(id) добавляется EP-03 (DTJ-063) эволюционной миграцией.
    pharmacyId: uuid('pharmacy_id'),
    // FK → pharmacy_chains(id) добавляется EP-03 эволюционной миграцией.
    chainId: uuid('chain_id'),
    telegramChatId: bigint('telegram_chat_id', { mode: 'bigint' }),
    preferredLocale: varchar('preferred_locale', { length: 5 }).notNull().default('tj'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: TIMESTAMPTZ('created_at').default(sql`NOW()`),
    // SRS-DB-004: soft delete (право на удаление ПДн). `null` = активен.
    deletedAt: TIMESTAMPTZ('deleted_at'),
  },
  (table) => [unique('unique_phone_per_tenant').on(table.tenantId, table.phoneNumber)],
)

export type UserRow = typeof users.$inferSelect
export type UserInsert = typeof users.$inferInsert

/** Реэкспорт `USER_ROLE_VALUES` для использования в CHECK-ограничениях миграции. */
export const _USER_ROLE_VALUES_REF = USER_ROLE_VALUES
