/**
 * `processed-events.schema.ts` (EP-01, DTJ-016, SRS-DOM-152) — журнал
 * идемпотентности потребителей outbox.
 *
 * Составной PK `(consumerName, eventId)` — КОНФЛИКТ вставки И ЕСТЬ
 * механизм детекции «уже обработано» (SRS-DOM-152). НЕ заводим отдельный
 * `id` — PK-конфликт при повторной вставке = «уже обработано», не ошибка.
 *
 * Каждый потребитель доменного события (например, `orders.on-delivered`,
 * `billing.on-payment-received`) ОБЯЗАН перед обработкой вставить строку
 * в эту таблицу. Конфликт → пропустить обработку.
 */
import { pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const processedEvents = pgTable(
  'processed_events',
  {
    consumerName: varchar('consumer_name', { length: 100 }).notNull(),
    eventId: uuid('event_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.consumerName, table.eventId] })],
)
