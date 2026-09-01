/**
 * Drizzle-схема `pharmacies` (EP-03, DTJ-063). Операционная точка
 * (`PharmacyAccount` aggregate). Полная DDL — 1:1 по `11-database-schema.md`
 * Группа A §2.
 *
 * Инвариант SRS-DOM-048 (доменный): `status='active'` требует
 * `parentChain.status ∈ {approved,active}`. FK на `pharmacy_chains` с
 * `ON DELETE CASCADE` (как в спецификации). `geo_point` опущен на этом шаге
 * (PostGIS-колонка, миграция 0008_postgis.sql — владение инфраструктуры, не EP-03).
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { pharmacyChains } from './pharmacy-chains.js'

export const PHARMACIES_TABLE = 'pharmacies'

export const pharmacies = pgTable(PHARMACIES_TABLE, {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  chainId: uuid('chain_id').references(() => pharmacyChains.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  addressText: text('address_text').notNull(),
  landmarkTj: text('landmark_tj'),
  latitude: numeric('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: numeric('longitude', { precision: 11, scale: 8 }).notNull(),
  phone: varchar('phone', { length: 30 }).notNull(),
  is24_7: boolean('is_24_7').default(false),
  openingTime: time('opening_time'),
  closingTime: time('closing_time'),
  oneCEndpoint: text('one_c_endpoint'),
  isActive: boolean('is_active').default(true),
  licenseNumber: varchar('license_number', { length: 100 }),
  licenseIssuingAuthority: varchar('license_issuing_authority', { length: 255 }),
  licenseIssueDate: date('license_issue_date'),
  licenseExpiryDate: date('license_expiry_date'),
  licenseScanUrl: text('license_scan_url'),
  pharmacistInChargeName: varchar('pharmacist_in_charge_name', { length: 255 }),
  status: varchar('status', { length: 32 }).notNull().default('draft'),
  suspensionReason: varchar('suspension_reason', { length: 32 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export type PharmacyRow = typeof pharmacies.$inferSelect
export type PharmacyInsert = typeof pharmacies.$inferInsert
