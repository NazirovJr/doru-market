// Интеграционный тест на реальном Postgres (не фейки), схема уже применена (0042_delivery_module_schema).
// Изоляция — тот же приём, что orders/cancel-order.use-case.integration.spec.ts: свой тенант/зона под фикс. UUID.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { isOk } from '@dorutj/domain-kernel'
import { DeliveryMinOrderNotMetError, DeliveryZoneNotCoveredError } from '@dorutj/contracts'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { Clock, GeoPoint as GeoPointType } from '@/shared-kernel/index.js'
import { UuidV7IdGeneratorAdapter } from '@/shared-kernel/infrastructure/adapters/uuidv7-id-generator.adapter.js'
import { AuditLogRepository } from '@/common/audit/infrastructure/audit-log.repository.js'
import { CalculateDeliveryFeeUseCase } from '@/modules/delivery/application/use-cases/calculate-delivery-fee.use-case.js'
import { ManageDeliveryPricingRulesUseCase } from '@/modules/delivery/application/use-cases/manage-delivery-pricing-rules.use-case.js'
import { DrizzleDeliveryZoneRepository } from '@/modules/delivery/infrastructure/repositories/delivery-zone.repository.js'
import { DrizzleDeliveryPricingRuleRepository } from '@/modules/delivery/infrastructure/repositories/delivery-pricing-rule.repository.js'
import type { DeliveryUnitOfWorkPort } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'

const TEST_DATABASE_URL =
  process.env.DELIVERY_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500

// Фиксированные UUID этого файла — namespace `10000000-...`, не пересекается с `catalog`/`orders`.
const TENANT_ID = '10000000-0000-4000-8000-0000000000d1'
const ZONE_ID = '10000000-0000-4000-8000-0000000000d2'
const ADMIN_USER_ID = '10000000-0000-4000-8000-0000000000d3'

const PHARMACY = geoPointOrThrow(38.57, 68.78)
const CUSTOMER_INSIDE = geoPointOrThrow(38.579, 68.78) // ~1km от PHARMACY, внутри радиуса 5км
const CUSTOMER_OUTSIDE = geoPointOrThrow(39.0, 68.78) // ~48km от PHARMACY, вне радиуса

const FIXED_CLOCK: Clock = { now: () => new Date('2026-09-05T05:00:00.000Z') } // 10:00 Asia/Dushanbe
const NIGHT_MOMENT = new Date('2026-09-05T18:30:00.000Z') // 23:30 Asia/Dushanbe

function geoPointOrThrow(lat: number, lon: number): GeoPointType {
  const result = GeoPoint.create(lat, lon)
  if (!isOk(result)) throw new Error('fixture: expected Ok')
  return result.value
}

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

describe.skipIf(!postgresAvailable)('CalculateDeliveryFeeUseCase / ManageDeliveryPricingRulesUseCase — integration', () => {
  let pool: Pool
  let db: NodePgDatabase
  let calculateFee: CalculateDeliveryFeeUseCase
  let manageRules: ManageDeliveryPricingRulesUseCase

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    const zonesRepo = new DrizzleDeliveryZoneRepository(db)
    const rulesRepo = new DrizzleDeliveryPricingRuleRepository(db)
    calculateFee = new CalculateDeliveryFeeUseCase(zonesRepo, rulesRepo, FIXED_CLOCK)
    const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
    const auditLog = new AuditLogRepository(db)
    manageRules = new ManageDeliveryPricingRulesUseCase(rulesRepo, uow, auditLog, new UuidV7IdGeneratorAdapter(), FIXED_CLOCK)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  async function cleanupOwnRows(): Promise<void> {
    await pool.query('DELETE FROM delivery_pricing_rules WHERE tenant_id = $1', [TENANT_ID])
    await pool.query('DELETE FROM delivery_zones WHERE tenant_id = $1', [TENANT_ID])
    await pool.query('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [ADMIN_USER_ID])
    await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
  }

  async function seedTenantAndZone(): Promise<void> {
    await pool.query(
      `INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, 'dtj322-delivery-test', false)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, is_neutral = EXCLUDED.is_neutral`,
      [TENANT_ID],
    )
    await pool.query(
      `INSERT INTO users (id, tenant_id, role, full_name) VALUES ($1, $2, 'super_admin', 'DTJ-322 Test Admin')
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN_USER_ID, TENANT_ID],
    )
    await pool.query(
      `INSERT INTO delivery_zones (id, tenant_id, name, center_latitude, center_longitude, radius_km, priority, is_active)
       VALUES ($1, $2, 'Zone DTJ-322', $3, $4, 5, 0, true)
       ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active`,
      [ZONE_ID, TENANT_ID, PHARMACY.latitude, PHARMACY.longitude],
    )
  }

  async function seedRule(overrides: {
    baseRateDiram?: number
    ratePerKmDiram?: number
    minOrderAmountDiram?: number
    freeDeliveryThresholdDiram?: number | null
    nightTariffStartTime?: string | null
    nightTariffEndTime?: string | null
    nightTariffExtraDiram?: number
  } = {}): Promise<void> {
    await pool.query(
      `INSERT INTO delivery_pricing_rules
         (tenant_id, zone_id, base_rate_diram, rate_per_km_diram, min_order_amount_diram,
          free_delivery_threshold_diram, night_tariff_start_time, night_tariff_end_time,
          night_tariff_extra_diram, effective_from, effective_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '2026-01-01', NULL)`,
      [
        TENANT_ID,
        ZONE_ID,
        overrides.baseRateDiram ?? 1000,
        overrides.ratePerKmDiram ?? 200,
        overrides.minOrderAmountDiram ?? 0,
        overrides.freeDeliveryThresholdDiram ?? null,
        overrides.nightTariffStartTime ?? null,
        overrides.nightTariffEndTime ?? null,
        overrides.nightTariffExtraDiram ?? 0,
      ],
    )
  }

  beforeEach(async () => {
    await cleanupOwnRows()
    await seedTenantAndZone()
  })

  afterEach(async () => {
    await cleanupOwnRows()
  })

  it('TC-DELIV-023: клиент вне всех зон тенанта -> DeliveryZoneNotCoveredError', async () => {
    await seedRule()
    await expect(
      calculateFee.execute({
        pharmacyGeoPoint: PHARMACY,
        customerGeoPoint: CUSTOMER_OUTSIDE,
        tenantId: TENANT_ID,
        itemsTotalDiram: 10000n,
      }),
    ).rejects.toBeInstanceOf(DeliveryZoneNotCoveredError)
  })

  it('TC-DELIV-024: itemsTotal=3000 < minOrderAmountDiram=5000 -> DeliveryMinOrderNotMetError', async () => {
    await seedRule({ minOrderAmountDiram: 5000 })
    await expect(
      calculateFee.execute({
        pharmacyGeoPoint: PHARMACY,
        customerGeoPoint: CUSTOMER_INSIDE,
        tenantId: TENANT_ID,
        itemsTotalDiram: 3000n,
      }),
    ).rejects.toBeInstanceOf(DeliveryMinOrderNotMetError)
  })

  it('TC-DELIV-026: baseRate=1000, ratePerKm=200 против реальной БД-строки -> формула шага 5', async () => {
    await seedRule({ baseRateDiram: 1000, ratePerKmDiram: 200 })
    const fee = await calculateFee.execute({
      pharmacyGeoPoint: PHARMACY,
      customerGeoPoint: CUSTOMER_INSIDE,
      tenantId: TENANT_ID,
      itemsTotalDiram: 10000n,
    })
    expect(fee).toBeGreaterThan(1000n)
  })

  it('TC-DELIV-025: itemsTotal >= freeDeliveryThreshold, ночь -> fee=0 (перекрывает ночной тариф) из реальной БД-строки', async () => {
    await seedRule({
      freeDeliveryThresholdDiram: 50000,
      nightTariffStartTime: '22:00',
      nightTariffEndTime: '06:00',
      nightTariffExtraDiram: 1000,
    })
    const fee = await calculateFee.execute({
      pharmacyGeoPoint: PHARMACY,
      customerGeoPoint: CUSTOMER_INSIDE,
      tenantId: TENANT_ID,
      itemsTotalDiram: 60000n,
      atMoment: NIGHT_MOMENT,
    })
    expect(fee).toBe(0n)
  })

  it('PUT delivery-pricing-rules: создаёт новую строку и закрывает предыдущую (история, не перезапись), пишет audit_log', async () => {
    const first = await manageRules.put({
      tenantId: TENANT_ID,
      zoneId: ZONE_ID,
      baseRateDiram: 1000n,
      ratePerKmDiram: 200n,
      minOrderAmountDiram: 0n,
      freeDeliveryThresholdDiram: null,
      nightTariffStartTime: null,
      nightTariffEndTime: null,
      nightTariffExtraDiram: 0n,
      actor: { userId: ADMIN_USER_ID, role: 'super_admin' },
    })
    const second = await manageRules.put({
      tenantId: TENANT_ID,
      zoneId: ZONE_ID,
      baseRateDiram: 1500n,
      ratePerKmDiram: 250n,
      minOrderAmountDiram: 0n,
      freeDeliveryThresholdDiram: null,
      nightTariffStartTime: null,
      nightTariffEndTime: null,
      nightTariffExtraDiram: 0n,
      actor: { userId: ADMIN_USER_ID, role: 'super_admin' },
    })

    const { rows } = await pool.query<{ id: string; effective_to: string | null }>(
      'SELECT id, effective_to FROM delivery_pricing_rules WHERE tenant_id = $1 ORDER BY effective_from',
      [TENANT_ID],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]?.id).toBe(first.id)
    expect(rows[0]?.effective_to).not.toBeNull() // старая строка закрыта, НЕ удалена/перезаписана
    expect(rows[1]?.id).toBe(second.id)
    expect(rows[1]?.effective_to).toBeNull()

    const audit = await pool.query<{ metadata: { extra?: { crossTenantOverride?: boolean } } }>(
      "SELECT metadata FROM audit_log WHERE entity_id = $1 AND action = 'delivery_pricing_rule_put'",
      [second.id],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]?.metadata.extra?.crossTenantOverride).toBe(true)
  })
})
