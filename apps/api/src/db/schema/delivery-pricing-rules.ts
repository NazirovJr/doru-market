/**
 * Drizzle-схема `delivery_pricing_rules` (EP-13, DTJ-313) — 1:1 `25-module-courier-delivery.md` §D.6.
 *
 * `zone_id IS NULL` = дефолтное правило тенанта вне зон; `tenant_id IS NULL` = глобальный дефолт.
 * `PUT /delivery-pricing-rules` создаёт НОВУЮ строку с `effective_from=now()` и закрывает
 * предыдущую (`effective_to=now()`) — история ставок не перезаписывается (тот же паттерн, что
 * `tenant_courier_payout_rules`/`commission_rates`), application-слой (DTJ-314+).
 */
import { sql } from 'drizzle-orm'
import { bigint, check, date, pgTable, time, uuid } from 'drizzle-orm/pg-core'
import { deliveryZones } from './delivery-zones.js'
import { tenants } from './tenants.js'

export const DELIVERY_PRICING_RULES_TABLE = 'delivery_pricing_rules'

const ZERO_DIRAM = 0n

export const deliveryPricingRules = pgTable(
  DELIVERY_PRICING_RULES_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    zoneId: uuid('zone_id').references(() => deliveryZones.id, { onDelete: 'cascade' }),
    baseRateDiram: bigint('base_rate_diram', { mode: 'bigint' }).notNull(),
    ratePerKmDiram: bigint('rate_per_km_diram', { mode: 'bigint' }).notNull(),
    minOrderAmountDiram: bigint('min_order_amount_diram', { mode: 'bigint' }).notNull().default(ZERO_DIRAM),
    /** `NULL` = бесплатная доставка не предлагается. */
    freeDeliveryThresholdDiram: bigint('free_delivery_threshold_diram', { mode: 'bigint' }),
    /** Asia/Dushanbe, `NULL` = ночной тариф выключен. */
    nightTariffStartTime: time('night_tariff_start_time'),
    nightTariffEndTime: time('night_tariff_end_time'),
    nightTariffExtraDiram: bigint('night_tariff_extra_diram', { mode: 'bigint' }).notNull().default(ZERO_DIRAM),
    effectiveFrom: date('effective_from').notNull().default(sql`CURRENT_DATE`),
    effectiveTo: date('effective_to'),
  },
  (table) => [
    check(
      'chk_delivery_pricing_rates_nonneg',
      sql`${table.baseRateDiram} >= 0 AND ${table.ratePerKmDiram} >= 0 AND ${table.minOrderAmountDiram} >= 0 AND ${table.nightTariffExtraDiram} >= 0`,
    ),
  ],
)

/** DTJ-322 — форма строки для `DrizzleDeliveryPricingRuleRepository` (тот же приём, что `CourierRow`). */
export type DeliveryPricingRuleRow = typeof deliveryPricingRules.$inferSelect
