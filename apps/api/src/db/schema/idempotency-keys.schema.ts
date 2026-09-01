/**
 * `idempotency-keys.schema.ts` (EP-01, DTJ-017, SRS-API-009/010/076) —
 * таблица идемпотентности для эндпоинтов с побочным эффектом
 * (checkout, рецепты, возвраты, диспуты, приём наличных курьером,
 * ротация 1С-ключа).
 *
 * **Механизм гонки (SRS-API-010):** строка `status='processing'`
 * создаётся СРАЗУ при получении заголовка `Idempotency-Key`. Конкурентный
 * дубль ловит `UNIQUE(user_id, endpoint, key)`-конфликт → `409
 * IDEMPOTENCY_KEY_CONFLICT` (см. `IdempotencyInterceptor`, DTJ-019).
 *
 * **TTL:** `IDEMPOTENCY_KEY_TTL_HOURS` (ASSUMPTION 24), очистка — фоновая
 * job (отдельный тикет, не здесь).
 */
import { integer, jsonb, pgEnum, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { users } from './users.js'

/** `idempotency_key_status` enum — добавляется в `enums.schema.ts` (DTJ-017). */
export const idempotencyKeyStatusEnum = pgEnum('idempotency_key_status', ['processing', 'completed'])

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: varchar('endpoint', { length: 255 }).notNull(), // напр. 'POST /api/v1/orders'
    key: uuid('key').notNull(), // клиентский Idempotency-Key, UUID v4
    requestHash: varchar('request_hash', { length: 64 }).notNull(), // sha256(body), hex
    status: idempotencyKeyStatusEnum('status').notNull().default('processing'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueUserEndpointKey: unique('unique_user_endpoint_key').on(
      table.userId,
      table.endpoint,
      table.key,
    ),
  }),
)
