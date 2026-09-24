// savingsDiram — bigint mode (целые дирамы, никогда float). id — DEFAULT gen_random_uuid(), не генерируется доменом.
import { sql } from 'drizzle-orm'
import { bigint, jsonb, pgTable, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'
import { users } from './users.js'
import { medicines } from './medicines.js'
import { pharmacies } from './pharmacies.js'
import { orders } from './orders.js'

const SESSION_ID_MAX_LENGTH = 128
const EVENT_TYPE_MAX_LENGTH = 50

export const PRODUCT_EVENTS_TABLE = 'product_events'

export const productEvents = pgTable(
  PRODUCT_EVENTS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), // NULL — гость, session_id — ключ
    sessionId: varchar('session_id', { length: SESSION_ID_MAX_LENGTH }).notNull(),
    eventType: varchar('event_type', { length: EVENT_TYPE_MAX_LENGTH }).notNull(),
    medicineId: uuid('medicine_id').references(() => medicines.id, { onDelete: 'set null' }),
    pharmacyId: uuid('pharmacy_id').references(() => pharmacies.id, { onDelete: 'set null' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    savingsDiram: bigint('savings_diram', { mode: 'bigint' }),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (table) => [
    index('idx_product_events_tenant_type_time').on(table.tenantId, table.eventType, table.occurredAt),
    index('idx_product_events_session').on(table.sessionId, table.occurredAt),
  ],
)

export type ProductEventRow = typeof productEvents.$inferSelect
export type ProductEventInsert = typeof productEvents.$inferInsert
