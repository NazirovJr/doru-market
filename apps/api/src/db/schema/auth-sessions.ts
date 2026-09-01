/**
 * Drizzle-схема `auth_sessions` (EP-01, DTJ-024/025, SRS-API-023/024/025/026/027, SRS-DOM-172/173).
 *
 * Назначение — материализованная сессия пользователя, ВЛАДЕЮЩАЯ refresh-токеном
 * (в виде `sha256(refreshToken)`, сам opaque refresh возвращается клиенту ОДИН
 * раз при создании, SRS-API-025). `auth_sessions.id` упоминается в JWT-claim'е
 * `sessionId` (SRS-API-024) — используется для `revoke` (DTJ-026) и для
 * аудита «с какого устройства зашли».
 *
 * Поля:
 *   - `id`              — UUID v7, primary key, FK-связь с JWT `sessionId`.
 *   - `tenant_id`       — UUID, FK на `tenants(id)` отложен (EP-02).
 *   - `user_id`         — UUID, FK на `users(id)` (DTJ-014).
 *   - `family_id`       — UUID, логическая группа сессий одного «логина»
 *                         (refresh-rotation, DTJ-025). При первом входе
 *                         равен `id`; при refresh — копируется из обновляемой
 *                         сессии. Здесь (DTJ-024) всегда = `id`.
 *   - `refresh_token_hash` — sha256(opaque 32 bytes), 64 hex.
 *   - `device_label`    — VARCHAR(64), эвристика из `User-Agent`
 *                         (`'browser'`/`'mobile-app'`/…; SRS-API-023).
 *   - `user_agent`      — TEXT, полный `User-Agent` для аудита.
 *   - `ip_address`      — INET (или VARCHAR(45) для IPv4+IPv6 совместимости
 *                         на проде; для R1 — VARCHAR(45)).
 *   - `absolute_expires_at` — TIMESTAMPTZ, `now() + 30 дней`
 *                         (SRS-API-023, `auth_sessions.absoluteExpiresAt`).
 *   - `rotated_at`      — TIMESTAMPTZ NULL, для DTJ-025 refresh-rotation:
 *                         `NULL` = текущее звено цепочки; `NOT NULL` = прошлое
 *                         звено, предъявление такого токена → REUSE_DETECTED
 *                         (SRS-API-027). Заполняется атомарно с созданием
 *                         новой `auth_sessions`-записи в той же транзакции.
 *   - `revoked_at`      — TIMESTAMPTZ NULL, для DTJ-026 (revoke / detect-reuse).
 *   - `revoke_reason`   — VARCHAR(32) NULL, причина отзыва
 *                         (`'user_logout'`/`'user_logout_all'`/`'reuse_detected'`/
 *                         `'admin_force'` — последнее в EP-15, DTJ-026).
 *   - `last_seen_at`    — TIMESTAMPTZ, время последнего «обращения» сессии
 *                         (refresh / list / me). В R1 (DTJ-026) инициализируется
 *                         равным `created_at` и обновляется на каждом refresh
 *                         (`rotateCurrentAndCreateNext`, DTJ-025). Endpoint
 *                         `GET /auth/sessions` (DTJ-026) отдаёт `last_seen_at`
 *                         как «когда в последний раз использовали это устройство».
 *                         Для active-сессий (`revoked_at IS NULL AND rotated_at IS NULL`)
 *                         `last_seen_at >= created_at` всегда.
 *   - `created_at`      — TIMESTAMPTZ.
 *
 * Индексы:
 *   - (user_id, revoked_at) — «список активных сессий пользователя» (DTJ-026).
 *   - (refresh_token_hash) UNIQUE — refresh-rotation и detect-reuse
 *     (DTJ-025; collision-space 2^256 — дубль технически невозможен,
 *     UNIQUE — на случай «hash после обновления refresh не успел
 *     удалиться, вторая попытка с тем же refresh»).
 *   - (family_id) — detect-reuse: `UPDATE ... WHERE family_id = :fid AND
 *     revoked_at IS NULL` (DTJ-025 §2.3, `revokeAllByFamilyId`).
 */
import { sql } from 'drizzle-orm'
import {
  customType,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users.js'

const TIMESTAMPTZ = customType<{ data: Date; driverData: string }>({
  dataType() {
    return 'timestamp with time zone'
  },
})

export const AUTH_SESSIONS_TABLE = 'auth_sessions'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на
// новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем
// проекта, см. `pharmacy-inventory.ts`).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
export const authSessions = pgTable(
  AUTH_SESSIONS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // FK → tenants(id) добавляется EP-02 эволюционной миграцией.
    tenantId: uuid('tenant_id').notNull(),
    // FK → users(id) — DTJ-014, таблица существует на момент этого тикета.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    refreshTokenHash: varchar('refresh_token_hash', { length: 64 }).notNull(),
    deviceLabel: varchar('device_label', { length: 64 }).notNull(),
    userAgent: text('user_agent').notNull(),
    ipAddress: varchar('ip_address', { length: 45 }).notNull(),
    absoluteExpiresAt: TIMESTAMPTZ('absolute_expires_at').notNull(),
    rotatedAt: TIMESTAMPTZ('rotated_at'),
    revokedAt: TIMESTAMPTZ('revoked_at'),
    revokeReason: varchar('revoke_reason', { length: 32 }),
    lastSeenAt: TIMESTAMPTZ('last_seen_at').notNull().default(sql`NOW()`),
    createdAt: TIMESTAMPTZ('created_at').notNull().default(sql`NOW()`),
  },
  (table) => ({
    byUser: index('ix_auth_sessions_by_user').on(table.userId, table.revokedAt),
    byRefreshHash: uniqueIndex('ux_auth_sessions_refresh_hash').on(table.refreshTokenHash),
    byFamily: index('ix_auth_sessions_by_family').on(table.familyId),
  }),
)

export type AuthSessionRow = typeof authSessions.$inferSelect
export type AuthSessionInsert = typeof authSessions.$inferInsert
