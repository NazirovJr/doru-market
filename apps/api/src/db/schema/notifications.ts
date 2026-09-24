/**
 * Drizzle-схема `notifications` (DTJ-370, `docs/spec/11-database-schema.md` §44, SRS-ADM-057).
 *
 * `sourceEventId` — ссылка на `outbox.id`, породивший уведомление (НЕ FK: `outbox` — append-only
 * лог, строки не удаляются, но и не гарантируется читаться обратно; дедупликация работает по
 * значению, не по целостности связи). `uq_notifications_dedup` = `UNIQUE(user_id, channel,
 * source_event_id)` — механизм идемпотентности `DispatchNotificationUseCase` (SRS-ADM-057):
 * повторная попытка insert с тем же ключом — конфликт, перехватывается репозиторием как no-op.
 */
import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { notificationChannelEnum, notificationStatusEnum } from './enums.schema.js'
import { users } from './users.js'
import { tenants } from './tenants.js'

const EVENT_TYPE_MAX_LENGTH = 100
const THROTTLE_KEY_MAX_LENGTH = 255

export const NOTIFICATIONS_TABLE = 'notifications'

export const notifications = pgTable(
  NOTIFICATIONS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // Nullable — 1:1 со спекой (`docs/spec/11-database-schema.md` §44): без NOT NULL на уровне БД.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channel: notificationChannelEnum('channel').notNull(),
    eventType: varchar('event_type', { length: EVENT_TYPE_MAX_LENGTH }),
    status: notificationStatusEnum('status').notNull().default('queued'),
    payload: jsonb('payload').notNull(),
    throttleKey: varchar('throttle_key', { length: THROTTLE_KEY_MAX_LENGTH }),
    sourceEventId: uuid('source_event_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedReason: text('failed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (table) => [
    unique('uq_notifications_dedup').on(table.userId, table.channel, table.sourceEventId),
    index('notifications_user_created_at_id_idx').on(table.userId, table.createdAt.desc(), table.id.desc()),
  ],
)

export type NotificationRow = typeof notifications.$inferSelect
export type NotificationInsert = typeof notifications.$inferInsert
