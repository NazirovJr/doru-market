/**
 * Drizzle-схема таблицы `tenants` (DTJ-051).
 *
 * Полная DDL — 1:1 по `11-database-schema.md` Группа C §13 + дополнения
 * `26-module-tenancy-whitelabel.md` §12 п.1–3 (single-chain unique index,
 * `custom_domain_status` enum, `domain_verification_token`).
 *
 * FK на `pharmacy_chains` определена как `ON DELETE RESTRICT` (Charter §3.4) и
 * `chk_tenants_neutral_has_no_chain` (SRS-DOM-042) — частичный уникальный
 * индекс `ux_tenants_single_neutral` (`WHERE is_neutral = true`) и
 * `ux_tenants_single_chain` (`WHERE chain_id IS NOT NULL`) добавляются
 * отдельной миграцией `0002_tenants_unique_chain.sql` (PostgreSQL требует
 * raw SQL для partial UNIQUE — Drizzle DSL это поддерживает через
 * `.unique().where(...)` начиная с `0.31`, но надёжнее ручной DDL).
 */
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  jsonb,
  bigint,
  integer,
  text,
  customType,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Кастомный PG enum `courier_sourcing_mode` (SRS-DB-007, `11-database-schema.md`).
 * Объявляем через `customType` — Drizzle поддерживает `pgEnum` отдельно,
 * но в этой схеме используем строковое поле + CHECK на уровне БД для совместимости
 * с будущими миграциями enum (PostgreSQL требует `ALTER TYPE` вне транзакции).
 */
const CUSTOM_DOMAIN_STATUS_VALUES = ['none', 'pending_verification', 'verified'] as const
export type CustomDomainStatusDb = (typeof CUSTOM_DOMAIN_STATUS_VALUES)[number]
/** Реэкспорт нужен, чтобы линтер не считал `CUSTOM_DOMAIN_STATUS_VALUES` неиспользуемым
 *  (используется в `typeof` выше — но ESLint `no-unused-vars` не видит эту связь). */
export const _CUSTOM_DOMAIN_STATUS_VALUES_REF = CUSTOM_DOMAIN_STATUS_VALUES

/** Дефолты per-tenant SLA/лимитов (11-database-schema.md §14). */
const DEFAULT_COD_LIMIT_DIRAM_SQL = sql`50000`
const DEFAULT_HOLD_PERIOD_DAYS = 1
const DEFAULT_PICKUP_SLA_MINUTES = 7
const DEFAULT_PICKUP_SLA_BUFFER_MINUTES = 5
const DEFAULT_DELIVERY_SLA_CITY_MINUTES = 240
const DEFAULT_DELIVERY_SLA_REMOTE_MINUTES = 1440
const DEFAULT_DISPUTE_WINDOW_HOURS = 24
const DEFAULT_INVENTORY_DELTA_SLA_MINUTES = 5
const DEFAULT_RETURN_RESTOCK_MIN_REMAINING_DAYS = 30
// DTJ-278/279 (EP-14, migration 0040_support_ticket_sla_fields.sql, SRS-ADM-075) — ASSUMPTION
// SUPPORT_FIRST_RESPONSE_SLA_MINUTES=60 из спеки, per-tenant поле, не константа в коде.
const DEFAULT_SUPPORT_FIRST_RESPONSE_SLA_MINUTES = 60
// [РАСШИРЕНИЕ, EP-12, DTJ-300, модуль 24] — параметры терминала фармацевта (SRS-PHT-019/029).
const DEFAULT_PARTIAL_FULFILLMENT_CONFIRMATION_TIMEOUT_MINUTES = 10
const DEFAULT_HANDOVER_OTP_MAX_REGENERATIONS_PER_ORDER = 20
const DEFAULT_HANDOVER_OTP_REGENERATE_MIN_INTERVAL_SECONDS = 60

export const tenants = pgTable('tenants', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  slug: varchar('slug', { length: 32 }).notNull().unique(),
  chainId: uuid('chain_id'),
  customDomain: varchar('custom_domain', { length: 255 }).unique(),
  isNeutral: boolean('is_neutral').notNull().default(false),
  courierSourcingMode: varchar('courier_sourcing_mode', { length: 32 }).notNull().default('platform_pool'),
  customDomainStatus: varchar('custom_domain_status', { length: 32 }).notNull().default('none'),
  domainVerificationToken: varchar('domain_verification_token', { length: 64 }),
  createdAt: customType<{ data: Date; driverData: string }>({
    dataType() {
      return 'timestamp with time zone'
    },
  })('created_at').default(sql`NOW()`),
})

/**
 * `tenant_settings` — value entity (1:1 с `tenants`, `ON DELETE CASCADE`).
 * Хранит брендинг (SRS-TEN-013) + per-tenant SLA/лимиты (D-03/D-04/D-19) +
 * ссылки на секреты (`merchant_credentials_ref`/`telegram_bot_token_ref`,
 * НЕ сами секреты — резолвятся через `SecretsVaultPort`, DTJ-058).
 *
 * `brand_palette` — JSONB (CSS custom properties), default `'{}'` — только что
 * провизионированный тенант стартует с пустой палитрой (SRS-TEN-038, fallback
 * `NEUTRAL_FALLBACK_PALETTE` отдаётся presentation-слоем при `GET /tenant/branding`).
 */
export const tenantSettings = pgTable(
  'tenant_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    brandName: varchar('brand_name', { length: 255 }).notNull(),
    brandLogoUrl: text('brand_logo_url'),
    brandLogoSquareUrl: text('brand_logo_square_url'),
    brandFaviconUrl: text('brand_favicon_url'),
    brandPalette: jsonb('brand_palette')
      .notNull()
      .default(sql`'{}'::jsonb`),
    telegramBotUsername: varchar('telegram_bot_username', { length: 64 }),
    telegramBotTokenRef: text('telegram_bot_token_ref'),
    merchantCredentialsRef: text('merchant_credentials_ref'),
    merchantCredentialsStatus: varchar('merchant_credentials_status', { length: 20 })
      .notNull()
      .default('not_configured'),
    supportPhone: varchar('support_phone', { length: 20 }),
    supportEmail: varchar('support_email', { length: 255 }),
    codLimitDiram: bigint('cod_limit_diram', { mode: 'bigint' })
      .notNull()
      .default(DEFAULT_COD_LIMIT_DIRAM_SQL),
    holdPeriodDays: integer('hold_period_days').notNull().default(DEFAULT_HOLD_PERIOD_DAYS),
    pickupSlaMinutes: integer('pickup_sla_minutes').notNull().default(DEFAULT_PICKUP_SLA_MINUTES),
    pickupSlaBufferMinutes: integer('pickup_sla_buffer_minutes')
      .notNull()
      .default(DEFAULT_PICKUP_SLA_BUFFER_MINUTES),
    deliverySlaCityMinutes: integer('delivery_sla_city_minutes')
      .notNull()
      .default(DEFAULT_DELIVERY_SLA_CITY_MINUTES),
    deliverySlaRemoteMinutes: integer('delivery_sla_remote_minutes')
      .notNull()
      .default(DEFAULT_DELIVERY_SLA_REMOTE_MINUTES),
    disputeWindowHours: integer('dispute_window_hours').notNull().default(DEFAULT_DISPUTE_WINDOW_HOURS),
    inventoryDeltaSlaMinutes: integer('inventory_delta_sla_minutes')
      .notNull()
      .default(DEFAULT_INVENTORY_DELTA_SLA_MINUTES),
    returnRestockMinRemainingDays: integer('return_restock_min_remaining_days')
      .notNull()
      .default(DEFAULT_RETURN_RESTOCK_MIN_REMAINING_DAYS),
    // DTJ-278/279 — читается CreateSupportTicketUseCase (EP-14) через TenantSettingsPort.
    supportFirstResponseSlaMinutes: integer('support_first_response_sla_minutes')
      .notNull()
      .default(DEFAULT_SUPPORT_FIRST_RESPONSE_SLA_MINUTES),
    defaultLocale: varchar('default_locale', { length: 5 }).notNull().default('tj'),
    // [РАСШИРЕНИЕ, EP-12, DTJ-300, модуль 24] — параметры терминала фармацевта (SRS-PHT-019/029).
    // Миграция 0041_pharmacy_terminal_schema.sql. Добавлены В ЭТОТ ЖЕ pgTable (НЕ отдельный файл
    // tenant-settings.ts — его не существует, tenant_settings всегда была таблицей внутри
    // tenants.ts, см. отчёт сдачи тикета).
    partialFulfillmentConfirmationTimeoutMinutes: integer('partial_fulfillment_confirmation_timeout_minutes')
      .notNull()
      .default(DEFAULT_PARTIAL_FULFILLMENT_CONFIRMATION_TIMEOUT_MINUTES),
    handoverOtpMaxRegenerationsPerOrder: integer('handover_otp_max_regenerations_per_order')
      .notNull()
      .default(DEFAULT_HANDOVER_OTP_MAX_REGENERATIONS_PER_ORDER),
    handoverOtpRegenerateMinIntervalSeconds: integer('handover_otp_regenerate_min_interval_seconds')
      .notNull()
      .default(DEFAULT_HANDOVER_OTP_REGENERATE_MIN_INTERVAL_SECONDS),
    updatedAt: customType<{ data: Date; driverData: string }>({
      dataType() {
        return 'timestamp with time zone'
      },
    })('updated_at').default(sql`NOW()`),
  },
  (table) => [
    check(
      'chk_tenant_settings_pht_ranges',
      sql`${table.partialFulfillmentConfirmationTimeoutMinutes} > 0 AND ${table.handoverOtpMaxRegenerationsPerOrder} > 0`,
    ),
  ],
)
