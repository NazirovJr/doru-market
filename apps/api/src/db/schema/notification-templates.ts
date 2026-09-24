/**
 * Drizzle-схема `notification_templates` (EP-16, DTJ-369, SRS-ADM-054/055/056). DDL — дословно
 * `docs/spec/27-module-admin-moderation-onboarding.md` §10.1, применена миграцией
 * `0049_notification_templates.sql`.
 *
 * `channel` — `notificationChannelEnum` (`enums.schema.ts`, эта же миграция) — СОГЛАСОВАНИЕ
 * `docs/spec/11-database-schema.md` (`telegram|sms|web_push|email`) и фактического кода EP-16
 * (`telegram|sms|web_push|in_app`), см. JSDoc enum'а.
 * `variablesSchema` — JSONB, форма — `NotificationTemplateVariablesSchema` домена (не типизирована
 * Drizzle'ом строже `unknown`, т.к. Drizzle не проверяет форму JSONB на уровне столбца).
 *
 * infrastructure-слой (`02` §1.1) — НЕ импортируется в `domain`/`application` модуля `notifications`.
 */
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
