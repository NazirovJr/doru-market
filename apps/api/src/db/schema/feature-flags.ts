/**
 * Drizzle-схема `feature_flags` (EP-15, DTJ-352, SRS-ADM-028). DDL — дословно
 * `27-module-admin-moderation-onboarding.md` §10.1, применена миграцией `0046_feature_flags.sql`.
 *
 * `scope` — `varchar(10)`, НЕ pg-enum (спецификация задаёт его именно так, значения проверяются
 * `chk_feature_flags_scope_tenant` + Zod `FEATURE_FLAG_SCOPE_VALUES` на уровне приложения).
 *
 * infrastructure-слой (`02` §1.1) — НЕ импортируется в `domain`/`application` модуля `admin`.
 */
import { sql } from 'drizzle-orm'
import { boolean, check, pgTable, smallint, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'
import { users } from './users.js'

const FLAG_KEY_MAX_LENGTH = 100
const SCOPE_MAX_LENGTH = 10
const DEFAULT_ROLLOUT_PERCENTAGE = 100

export const FEATURE_FLAGS_TABLE = 'feature_flags'

export const featureFlags = pgTable(
  FEATURE_FLAGS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    flagKey: varchar('flag_key', { length: FLAG_KEY_MAX_LENGTH }).notNull(),
    scope: varchar('scope', { length: SCOPE_MAX_LENGTH }).notNull().default('global'),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    isEnabled: boolean('is_enabled').notNull().default(false),
    rolloutPercentage: smallint('rollout_percentage').notNull().default(DEFAULT_ROLLOUT_PERCENTAGE),
    description: text('description'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (table) => [
    check(
      'chk_feature_flags_scope_tenant',
      sql`(${table.scope} = 'global' AND ${table.tenantId} IS NULL) OR (${table.scope} = 'tenant' AND ${table.tenantId} IS NOT NULL)`,
    ),
    check('chk_feature_flags_rollout_range', sql`${table.rolloutPercentage} BETWEEN 0 AND 100`),
    unique('uq_feature_flags_key_scope').on(table.flagKey, table.scope, table.tenantId),
  ],
)

export type FeatureFlagRow = typeof featureFlags.$inferSelect
export type FeatureFlagInsert = typeof featureFlags.$inferInsert
