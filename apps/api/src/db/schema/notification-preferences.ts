/** Drizzle-схема `notification_preferences` (SRS-ADM-058/059, §6.4). PK составной, без суррогатного id. */
import { sql } from 'drizzle-orm'
import { boolean, pgTable, primaryKey, time, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { notificationChannelEnum } from './enums.schema.js'
import { users } from './users.js'

const CATEGORY_MAX_LENGTH = 50

export const NOTIFICATION_PREFERENCES_TABLE = 'notification_preferences'

export const notificationPreferences = pgTable(
  NOTIFICATION_PREFERENCES_TABLE,
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: varchar('category', { length: CATEGORY_MAX_LENGTH }).notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    quietHoursStart: time('quiet_hours_start'),
    quietHoursEnd: time('quiet_hours_end'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.category, table.channel] })],
)

export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect
export type NotificationPreferenceInsert = typeof notificationPreferences.$inferInsert
