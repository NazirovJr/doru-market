/**
 * Drizzle-схема «Группа F» — `order_returns` (EP-11, DTJ-270). DDL 1:1 `11-database-schema.md`
 * строки 935-951, применена миграцией `0037_returns_disputes_support.sql`.
 *
 * `OrderReturn` — доменный агрегат (EP-11 владеет `modules/returns/domain/**`, DTJ-271) — эта
 * схема лишь физическое хранение, домен читает её ТОЛЬКО через свой репозиторий
 * (`application/ports/*.repository.port.ts`, будущий тикет DTJ-273, вне периметра этой волны).
 *
 * `courierId` — БЕЗ `.references()` (тот же приём, что `orders.courierId` в `db/schema/orders.ts`):
 * таблица `couriers` физически не существует ни в одной миграции (EP-13) — FK добавляется
 * `ALTER TABLE` будущей миграцией группы H, когда таблица появится (см. комментарий в самой
 * миграции 0037 и в каноническом DDL, строка 942).
 */
import { sql } from 'drizzle-orm'
import { bigint, boolean, pgTable, text, timestamp, uuid, check } from 'drizzle-orm/pg-core'
import { returnStatusEnum, returnReasonEnum, returnDispositionEnum } from './enums.schema.js'
import { orders } from './orders.js'
import { users } from './users.js'

export const ORDER_RETURNS_TABLE = 'order_returns'

export const orderReturns = pgTable(
  ORDER_RETURNS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    status: returnStatusEnum('status').notNull().default('return_requested'),
    reason: returnReasonEnum('reason').notNull(),
    disposition: returnDispositionEnum('disposition'),
    initiatedBy: uuid('initiated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // FK → couriers(id) добавляется ALTER TABLE после CREATE TABLE couriers (группа H, EP-13).
    courierId: uuid('courier_id'),
    courierReturnFeeDiram: bigint('courier_return_fee_diram', { mode: 'bigint' }).notNull().default(sql`0`),
    packagingIntact: boolean('packaging_intact'),
    checklistNotes: text('checklist_notes'),
    adminOverrideReason: text('admin_override_reason'),
    adminOverrideBy: uuid('admin_override_by').references(() => users.id, { onDelete: 'set null' }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().default(sql`NOW()`),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [check('chk_order_returns_fee_nonneg', sql`${table.courierReturnFeeDiram} >= 0`)],
)

export type OrderReturnRow = typeof orderReturns.$inferSelect
export type OrderReturnInsert = typeof orderReturns.$inferInsert
