/**
 * `outbox.schema.ts` (EP-01, DTJ-016, SRS-DOM-151/152, SRS-DB-024) —
 * таблица transactional outbox для атомарной записи доменных событий
 * в той же транзакции, что и изменение агрегата.
 *
 * `OutboxRelayWorker` (DTJ-002/016) читает `status='pending'`, публикует
 * в очередь `domain-events` (BullMQ), выставляет `status='published'`.
 * Сбой публикации → `status` остаётся `pending`, `publishAttempts++`.
 *
 * `tenantId` БЕЗ `.references(...)` — отложенный FK (tenants создаётся
 * позднее, тот же паттерн DTJ-014, см. тикет).
 */
import { sql } from 'drizzle-orm'
import { jsonb, pgEnum, pgTable, timestamp, uuid, varchar, integer, index } from 'drizzle-orm/pg-core'

/** `outbox_status` enum — добавляется в `enums.schema.ts` (DTJ-016, по правилу «дописывать»). */
export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'published', 'failed'])

export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 50 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    tenantId: uuid('tenant_id'), // см. JSDoc выше — отложенный FK
    status: outboxStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishAttempts: integer('publish_attempts').notNull().default(0),
  },
  (table) => [
    // Partial index — оптимизация `WHERE status='pending' ORDER BY created_at`
    // (используется в `OutboxRelayWorker`).
    index('outbox_pending_created_at_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
  ],
)
