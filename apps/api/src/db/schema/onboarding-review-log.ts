/**
 * Drizzle-схема `onboarding_review_log` (EP-03, DTJ-063). Append-only журнал
 * решений `super_admin` по заявкам (REQ-ONBOARD-7).
 *
 * Хотя бы одно из `pharmacy_id`/`chain_id` заполнено (CHECK
 * `chk_onboarding_log_one_subject`) — `super_admin` может зафиксировать
 * «событие без конкретной заявки» (например, системная приостановка
 * `license_expired` от джобы, actor=`SYSTEM`), но не «без указания типа
 * субъекта вообще».
 *
 * `users` FK — `ON DELETE RESTRICT` (как в спецификации), `actor_user_id`
 * не определён строгим `references()` по той же причине, что и
 * `pharmacy_verification.reviewed_by` — таблица `users` ещё не определена
 * в этой Drizzle-схеме.
 */
import { sql } from 'drizzle-orm'
import { check, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { pharmacyChains } from './pharmacy-chains.js'
import { pharmacies } from './pharmacies.js'

export const ONBOARDING_REVIEW_LOG_TABLE = 'onboarding_review_log'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на новый
// массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
export const onboardingReviewLog = pgTable(
  ONBOARDING_REVIEW_LOG_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pharmacyId: uuid('pharmacy_id').references(() => pharmacies.id, { onDelete: 'cascade' }),
    chainId: uuid('chain_id').references(() => pharmacyChains.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 30 }).notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    reason: text('reason'),
    checklistSnapshot: jsonb('checklist_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    oneSubject: check(
      'chk_onboarding_log_one_subject',
      sql`${table.pharmacyId} IS NOT NULL OR ${table.chainId} IS NOT NULL`,
    ),
  }),
)

export type OnboardingReviewLogRow = typeof onboardingReviewLog.$inferSelect
export type OnboardingReviewLogInsert = typeof onboardingReviewLog.$inferInsert
