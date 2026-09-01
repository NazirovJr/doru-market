/**
 * Drizzle-схема `pharmacy_verification` (EP-03, DTJ-063). Текущее состояние
 * верификации (одна активная запись на субъект — точку ИЛИ юрлицо).
 *
 * Базовая DDL — 1:1 по `11-database-schema.md` §38 + дополнения
 * `27-module-admin-moderation-onboarding.md` §10.1 (review_reason, revoked_*).
 *
 * CHECK `chk_pharmacy_verification_one_subject` — ровно одно из
 * `pharmacy_id`/`chain_id` заполнено (REQ-ONBOARD-1).
 *
 * `users` FK на `reviewed_by` — таблица `users` в EP-01; на этом шаге
 * ссылка определена как нестрогая (без `references()`) — Drizzle-kit не
 * может сгенерировать ссылку на не существующую в схеме таблицу; ограничение
 * на уровне БД присутствует (`0014_users.sql` владеет EP-01).
 */
import { sql } from 'drizzle-orm'
import { check, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { pharmacyChains } from './pharmacy-chains.js'
import { pharmacies } from './pharmacies.js'

export const PHARMACY_VERIFICATION_TABLE = 'pharmacy_verification'

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на новый
// массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта).
export const pharmacyVerification = pgTable(
  PHARMACY_VERIFICATION_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pharmacyId: uuid('pharmacy_id').references(() => pharmacies.id, { onDelete: 'cascade' }),
    chainId: uuid('chain_id').references(() => pharmacyChains.id, { onDelete: 'cascade' }),
    verificationStatus: varchar('verification_status', { length: 32 }).notNull().default('not_started'),
    checklistSnapshot: jsonb('checklist_snapshot'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    slaTargetAt: timestamp('sla_target_at', { withTimezone: true }),
    reviewReason: varchar('review_reason', { length: 30 }).notNull().default('initial'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    revokedBy: uuid('revoked_by'),
  },
  (table) => ({
    oneSubject: check(
      'chk_pharmacy_verification_one_subject',
      sql`(${table.pharmacyId} IS NOT NULL AND ${table.chainId} IS NULL) OR (${table.pharmacyId} IS NULL AND ${table.chainId} IS NOT NULL)`,
    ),
  }),
)

export type PharmacyVerificationRow = typeof pharmacyVerification.$inferSelect
export type PharmacyVerificationInsert = typeof pharmacyVerification.$inferInsert
