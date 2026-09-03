/**
 * Drizzle-схема `support_ticket_messages` (EP-14, DTJ-278). Append-only переписка по тикету —
 * физический источник «первый комментарий `support_agent`» для `support_tickets.
 * first_responded_at` (SRS-ADM-075). Применена миграцией `0038_support_ticket_sla_fields.sql`.
 *
 * Дополнение сверх буквы `11-database-schema.md` (та таблица не описана ни одним документом
 * `docs/spec/`) — осознанное расширение, см. header-комментарий миграции и «Риски» DTJ-278.
 *
 * `SupportTicketMessage` — дочерняя сущность агрегата `SupportTicket` (EP-14 владеет
 * `modules/support/domain/**`, DTJ-278) — эта схема лишь физическое хранение.
 */
import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { userRoleEnum } from './enums.schema.js'
import { supportTickets } from './support.js'
import { users } from './users.js'

export const SUPPORT_TICKET_MESSAGES_TABLE = 'support_ticket_messages'

export const supportTicketMessages = pgTable(SUPPORT_TICKET_MESSAGES_TABLE, {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => supportTickets.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
  authorRole: userRoleEnum('author_role').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`NOW()`),
})

export type SupportTicketMessageRow = typeof supportTicketMessages.$inferSelect
export type SupportTicketMessageInsert = typeof supportTicketMessages.$inferInsert
