/**
 * Drizzle-схема `pharmacy_chains` (EP-03, DTJ-063). Юрлицо-владелец 1..N аптек
 * (SRS-DOM-047, `PharmacyChain` aggregate). Полная DDL — 1:1 по
 * `11-database-schema.md` Группа A §1, без FK на `tenants` (отложенная
 * `0015_deferred_fks.sql` per `11-db`).
 *
 * `status` — `chain_onboarding_status` enum. `tin_inn` — UNIQUE (REQ-ONBOARD-19).
 * Дополнения DTJ-064 (`contact_phone_verified`) добавляются отдельной миграцией.
 */
import { sql } from 'drizzle-orm'
import { boolean, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const PHARMACY_CHAINS_TABLE = 'pharmacy_chains'

export const pharmacyChains = pgTable(PHARMACY_CHAINS_TABLE, {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 255 }).notNull(),
  legalEntityName: varchar('legal_entity_name', { length: 255 }).notNull(),
  tinInn: varchar('tin_inn', { length: 20 }).notNull().unique(),
  logoUrl: text('logo_url'),
  isWhitelabelActive: boolean('is_whitelabel_active').default(false),
  customDomain: varchar('custom_domain', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  legalAddress: text('legal_address'),
  registrationCertificateUrl: text('registration_certificate_url'),
  directorFullName: varchar('director_full_name', { length: 255 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  bankAccountRef: text('bank_account_ref'),
  payoutMerchantRef: text('payout_merchant_ref'),
  isWhitelabelRequested: boolean('is_whitelabel_requested').notNull().default(false),
  status: varchar('status', { length: 32 }).notNull().default('draft'),
  tenantId: uuid('tenant_id'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  contactPhoneVerified: boolean('contact_phone_verified').notNull().default(false),
})

export type PharmacyChainRow = typeof pharmacyChains.$inferSelect
export type PharmacyChainInsert = typeof pharmacyChains.$inferInsert
