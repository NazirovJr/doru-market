/** Drizzle-схема `notification_templates`; `variablesSchema` — JSONB, форма не типизирована строже `unknown`. */
import { sql } from 'drizzle-orm'
import { jsonb, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { notificationChannelEnum } from './enums.schema.js'

const EVENT_TYPE_MAX_LENGTH = 100
const LOCALE_MAX_LENGTH = 5

export const NOTIFICATION_TEMPLATES_TABLE = 'notification_templates'

export const notificationTemplates = pgTable(
  NOTIFICATION_TEMPLATES_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    eventType: varchar('event_type', { length: EVENT_TYPE_MAX_LENGTH }).notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    locale: varchar('locale', { length: LOCALE_MAX_LENGTH }).notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    variablesSchema: jsonb('variables_schema').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (table) => [unique('uq_notification_templates').on(table.eventType, table.channel, table.locale)],
)

export type NotificationTemplateRow = typeof notificationTemplates.$inferSelect
export type NotificationTemplateInsert = typeof notificationTemplates.$inferInsert
