/**
 * Drizzle-схема «Группа F» — `support_tickets` / `order_disputes` / `dispute_status_history`
 * (EP-11/14, DTJ-270).
 *
 * `supportTickets` — ПЕРВОЕ типизированное Drizzle-определение уже существующей таблицы:
 * физически создана миграцией `0034_support_tickets_audit_log.sql` (DTJ-247, побочный продукт
 * `EscrowReconciliationJob`, `apps/worker`), но та миграция писалась через сырой `pg`-адаптер
 * (`apps/worker/src/jobs/payout/pg-support-ticket.adapter.ts`), не через Drizzle — колонки ниже
 * сверены с РЕАЛЬНОЙ таблицей (`\d support_tickets` на живой БД), не с урезанным предположением
 * тикета. SLA-поля (`first_response_due_at`/`first_responded_at`/`priority`) добавляет
 * `ALTER TABLE` миграция DTJ-278 (`0038_support_ticket_sla_fields.sql`) — эта схема их пока не
 * содержит, DTJ-278 дополнит файл СВОИМИ тремя полями поверх этого же `pgTable`.
 *
 * `orderDisputes`/`disputeStatusHistory` — новые таблицы, DDL 1:1 `11-database-schema.md`
 * строки 988-1030, применены той же миграцией `0037_returns_disputes_support.sql`. Фундамент без
 * домена/use case поверх них в этом диапазоне тикетов (D-EP11-6) — размещены здесь, а не в
 * `returns.ts`, по буквальному указанию DTJ-270 п.3 (обе принадлежат DDL-группе
 * «споры/поддержка», не «возвраты»).
 *
 * `supportTickets.firstResponseDueAt`/`firstRespondedAt`/`priority` — SLA-расширение (EP-14,
 * DTJ-278, `27-module-admin-moderation-onboarding.md` строки 986-994, SRS-ADM-075/076/078),
 * миграция `0038_support_ticket_sla_fields.sql` (`ALTER TABLE` поверх этого же `pgTable`, не
 * отдельный файл — Drizzle требует, чтобы все колонки таблицы были в одном определении).
 */
import { sql } from 'drizzle-orm'
import { bigint, boolean, check, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import {
  disputeStatusEnum,
  supportTicketCategoryEnum,
  supportTicketChannelEnum,
  supportTicketStatusEnum,
  userRoleEnum,
} from './enums.schema.js'
import { orders } from './orders.js'
import { tenants } from './tenants.js'
import { users } from './users.js'

export const SUPPORT_TICKETS_TABLE = 'support_tickets'

export const supportTickets = pgTable(SUPPORT_TICKETS_TABLE, {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  channel: supportTicketChannelEnum('channel').notNull(),
  category: supportTicketCategoryEnum('category').notNull(),
  isEscrowBlocking: boolean('is_escrow_blocking').notNull().default(false),
  status: supportTicketStatusEnum('status').notNull().default('open'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`NOW()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`NOW()`),
  // DTJ-278 (0038_support_ticket_sla_fields.sql) — SLA первого ответа + приоритет, см. JSDoc файла.
  firstResponseDueAt: timestamp('first_response_due_at', { withTimezone: true }),
  firstRespondedAt: timestamp('first_responded_at', { withTimezone: true }),
  priority: smallint('priority').notNull().default(0),
})

export type SupportTicketRow = typeof supportTickets.$inferSelect
export type SupportTicketInsert = typeof supportTickets.$inferInsert

export const ORDER_DISPUTES_TABLE = 'order_disputes'

export const orderDisputes = pgTable(
  ORDER_DISPUTES_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    supportTicketId: uuid('support_ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'restrict' }),
    status: disputeStatusEnum('status').notNull().default('open'),
    priority: smallint('priority').notNull().default(0),
    resolutionReason: text('resolution_reason'),
    resolutionAmountDiram: bigint('resolution_amount_diram', { mode: 'bigint' }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    resolvedByRole: userRoleEnum('resolved_by_role'),
    resolutionDueAt: timestamp('resolution_due_at', { withTimezone: true }).notNull(),
    slaPausedAt: timestamp('sla_paused_at', { withTimezone: true }),
    tenantRefundConfirmedAt: timestamp('tenant_refund_confirmed_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().default(sql`NOW()`),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'chk_order_disputes_terminal_requires_reason',
      sql`${table.status} NOT IN ('resolved_reject', 'resolved_refund_full', 'resolved_refund_partial', 'resolved_adjustment')
          OR (${table.resolutionReason} IS NOT NULL AND ${table.resolvedByUserId} IS NOT NULL)`,
    ),
  ],
)

export type OrderDisputeRow = typeof orderDisputes.$inferSelect
export type OrderDisputeInsert = typeof orderDisputes.$inferInsert

export const DISPUTE_STATUS_HISTORY_TABLE = 'dispute_status_history'

export const disputeStatusHistory = pgTable(DISPUTE_STATUS_HISTORY_TABLE, {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  disputeId: uuid('dispute_id')
    .notNull()
    .references(() => orderDisputes.id, { onDelete: 'cascade' }),
  statusFrom: disputeStatusEnum('status_from'),
  statusTo: disputeStatusEnum('status_to').notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`NOW()`),
})

export type DisputeStatusHistoryRow = typeof disputeStatusHistory.$inferSelect
export type DisputeStatusHistoryInsert = typeof disputeStatusHistory.$inferInsert
