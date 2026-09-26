// AnalyticsDashboardController — Supertest integration (DTJ-381) против реальных Postgres/Redis.
// Харнесс — тот же `createTestApp` (analytics-events-test-app.ts), что DTJ-379: AnalyticsModule
// теперь регистрирует ОБА контроллера, отдельный тест-модуль не нужен (Ж12).
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/analytics-events-test-app.js'

const TEST_DATABASE_URL =
  process.env.ANALYTICS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'
const TEST_REDIS_URL = process.env.ANALYTICS_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6380/0'
const PROBE_TIMEOUT_MS = 1_500

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

interface ErrorBody {
  readonly error: { readonly code: string }
}
interface FunnelBody {
  readonly searchPerformed: number
  readonly analogShown: number
  readonly analogClicked: number
  readonly addedToCart: number
  readonly orderPlaced: number
  readonly conversionRates: {
    readonly shownToClicked: number
    readonly clickedToCart: number
    readonly cartToOrder: number
    readonly overallShownToOrder: number
  }
  readonly totalSavingsShownDiram: number
  readonly totalSavingsRealizedDiram: number
  readonly weeklyTrend: readonly { readonly weekLabel: string; readonly realizedSavingsDiram: number }[]
}
interface SuccessBody<T> {
  readonly data: T
}

const AUGUST_PERIOD = '2026-08'
const AUGUST_START = new Date('2026-08-15T12:00:00.000Z')
const JULY_31_END = new Date('2026-07-31T23:59:59.999Z')
const SEPTEMBER_START = new Date('2026-09-01T00:00:00.000Z')

describe.skipIf(!postgresAvailable)('AnalyticsDashboardController — Supertest integration (DTJ-381)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const tenantId = randomUUID()
  const operatorTenantId = randomUUID()
  const otherTenantId = randomUUID()
  const createdUserIds: string[] = []

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedUser(role: string): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, $4, true)`, [
      id,
      operatorTenantId,
      `+99292${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
      role,
    ])
    createdUserIds.push(id)
    return id
  }

  async function seedEventCount(input: { forTenantId: string; eventType: string; occurredAt: Date; n: number }): Promise<void> {
    if (input.n === 0) return
    await pool.query(
      `INSERT INTO product_events (tenant_id, session_id, event_type, occurred_at)
       SELECT $1, gen_random_uuid()::text, $2, $3 FROM generate_series(1, $4)`,
      [input.forTenantId, input.eventType, input.occurredAt, input.n],
    )
  }

  async function seedSavingsEvent(eventType: string, occurredAt: Date, savingsDiram: bigint): Promise<void> {
    await pool.query(
      `INSERT INTO product_events (tenant_id, session_id, event_type, savings_diram, occurred_at) VALUES ($1, gen_random_uuid()::text, $2, $3, $4)`,
      [tenantId, eventType, savingsDiram, occurredAt],
    )
  }

  function getFunnel(token: string, forTenantId: string, period: string): request.Test {
    return request(httpServer)
      .get(`/api/v1/analytics/funnel?tenantId=${forTenantId}&period=${period}`)
      .set('Authorization', `Bearer ${token}`)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    for (const id of [tenantId, operatorTenantId, otherTenantId]) {
      await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
        id,
        `test-analytics-dash-${id.slice(0, 8)}`,
      ])
    }
    ctx = await createTestApp(TEST_DATABASE_URL, TEST_REDIS_URL)
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM product_events WHERE tenant_id = ANY($1)', [[tenantId, otherTenantId]])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantId, operatorTenantId, otherTenantId]])
      await pool.end().catch(() => undefined)
    }
  })

  it('TC-ADM-029 — analog_shown=100, analog_clicked=20, added_to_cart=15, order_placed=10 → overallShownToOrder=0.10', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })
    await seedEventCount({ forTenantId: tenantId, eventType: 'search_performed', occurredAt: AUGUST_START, n: 500 })
    await seedEventCount({ forTenantId: tenantId, eventType: 'analog_shown', occurredAt: AUGUST_START, n: 100 })
    await seedEventCount({ forTenantId: tenantId, eventType: 'analog_clicked', occurredAt: AUGUST_START, n: 20 })
    await seedEventCount({ forTenantId: tenantId, eventType: 'added_to_cart', occurredAt: AUGUST_START, n: 15 })
    await seedEventCount({ forTenantId: tenantId, eventType: 'order_placed', occurredAt: AUGUST_START, n: 10 })
    // Границы периода: события ДО/ПОСЛЕ августа не должны попасть в счёт.
    await seedEventCount({ forTenantId: tenantId, eventType: 'analog_shown', occurredAt: JULY_31_END, n: 1 })
    await seedEventCount({ forTenantId: tenantId, eventType: 'analog_shown', occurredAt: SEPTEMBER_START, n: 1 })

    const res = await getFunnel(token, tenantId, AUGUST_PERIOD)

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<FunnelBody>).data
    expect(body.searchPerformed).toBe(500)
    expect(body.analogShown).toBe(100)
    expect(body.analogClicked).toBe(20)
    expect(body.addedToCart).toBe(15)
    expect(body.orderPlaced).toBe(10)
    expect(body.conversionRates.overallShownToOrder).toBe(0.1)
  })

  it('АС2 — период без событий вообще → все счётчики 0, конверсии 0, НЕ NaN/Infinity/ошибка', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })
    const emptyTenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      emptyTenantId,
      `test-dash-empty-${emptyTenantId.slice(0, 8)}`, // varchar(32): короче основного префикса
    ])

    const res = await getFunnel(token, emptyTenantId, '2020-01')

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<FunnelBody>).data
    expect(body.conversionRates).toEqual({ shownToClicked: 0, clickedToCart: 0, cartToOrder: 0, overallShownToOrder: 0 })
    expect(body.totalSavingsShownDiram).toBe(0)
    expect(body.totalSavingsRealizedDiram).toBe(0)

    await pool.query('DELETE FROM tenants WHERE id = $1', [emptyTenantId])
  })

  it('АС3 + DTJ-380 сквозной сценарий — totalSavingsShownDiram и totalSavingsRealizedDiram суммируются НЕЗАВИСИМО, оба присутствуют одновременно', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })
    await seedSavingsEvent('analog_shown', AUGUST_START, 40_000n)
    await seedSavingsEvent('analog_shown', AUGUST_START, 60_000n)
    // order_placed с savingsDiram, посчитанным RealizedSavingsCalculator (DTJ-380) — здесь эмулируется прямой вставкой строки,
    // т.к. полный checkout-флоу принадлежит модулю orders (вне periметра DTJ-381).
    await seedSavingsEvent('order_placed', AUGUST_START, 15_000n)

    const res = await getFunnel(token, tenantId, AUGUST_PERIOD)

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<FunnelBody>).data
    expect(body.totalSavingsShownDiram).toBe(100_000)
    expect(body.totalSavingsRealizedDiram).toBe(15_000)
  })

  it('АС4 — pharmacy_admin → 403 INSUFFICIENT_ROLE (экран исключительно платформенный)', async () => {
    const pharmacyAdminId = await seedUser('pharmacy_admin')
    const token = sign({ sub: pharmacyAdminId, role: 'pharmacy_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })

    const res = await getFunnel(token, tenantId, AUGUST_PERIOD)

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('без Authorization → 401, не тихий откат к гостю', async () => {
    const res = await request(httpServer).get(`/api/v1/analytics/funnel?tenantId=${tenantId}&period=${AUGUST_PERIOD}`)

    expect(res.status).toBe(401)
  })

  it('невалидный формат period → 400 VALIDATION_ERROR', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })

    const res = await getFunnel(token, tenantId, 'август-2026')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })

  it('события ДРУГОГО tenantId не попадают в агрегат (тенант-изоляция)', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })
    await seedEventCount({ forTenantId: otherTenantId, eventType: 'analog_shown', occurredAt: AUGUST_START, n: 999 })

    const res = await getFunnel(token, tenantId, AUGUST_PERIOD)

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<FunnelBody>).data
    expect(body.analogShown).not.toBe(999)
  })

  it('weeklyTrend — 7 точек, последняя содержит выбранный период, реализованная экономия просуммирована по неделе', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })
    await seedSavingsEvent('order_placed', AUGUST_START, 7_000n)

    const res = await getFunnel(token, tenantId, AUGUST_PERIOD)

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<FunnelBody>).data
    expect(body.weeklyTrend).toHaveLength(7)
    const total = body.weeklyTrend.reduce((sum, point) => sum + point.realizedSavingsDiram, 0)
    expect(total).toBeGreaterThanOrEqual(7_000)
    for (const point of body.weeklyTrend) {
      expect(point.weekLabel).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

interface PlatformMetricsBody {
  readonly gmvDiram: number
  readonly orderCount: number
  readonly averageCheckDiram: number
  readonly pickupSlaComplianceRate: number
  readonly deliverySlaComplianceRate: number
  readonly cancellationRate: number
  readonly activePharmaciesSendingDataRate: number
}

describe.skipIf(!postgresAvailable)('AnalyticsDashboardController.platformMetrics — Supertest integration (DTJ-382)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const operatorTenantId = randomUUID()
  const tenantId = randomUUID()
  const createdUserIds: string[] = []
  const createdOrderIds: string[] = []
  const createdPharmacyIds: string[] = []
  const createdChainIds: string[] = []
  const MS_PER_DAY = 86_400_000

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedUser(role: string): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, $4, true)`, [
      id,
      operatorTenantId,
      `+99293${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
      role,
    ])
    createdUserIds.push(id)
    return id
  }

  function getPlatformMetrics(token: string, forTenantId: string, period: string): request.Test {
    return request(httpServer)
      .get(`/api/v1/analytics/platform-metrics?tenantId=${forTenantId}&period=${period}`)
      .set('Authorization', `Bearer ${token}`)
  }

  async function seedPharmacyChainForTenant(forTenantId: string, status: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status, tenant_id)
       VALUES ($1, 'Test Chain DTJ-382', 'Test Chain LLC', $2, $3, $4)`,
      [id, `tin-${id.slice(0, 12)}`, status, forTenantId],
    )
    createdChainIds.push(id)
    return id
  }

  async function seedPharmacyForChain(chainId: string, status: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, 'Test Pharmacy DTJ-382', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000002', $3)`,
      [id, chainId, status],
    )
    createdPharmacyIds.push(id)
    return id
  }

  async function seedInventorySyncBatch(pharmacyId: string, receivedAt: Date): Promise<void> {
    await pool.query(`INSERT INTO inventory_sync_batch (pharmacy_id, channel, received_at) VALUES ($1, 'rest', $2)`, [
      pharmacyId,
      receivedAt,
    ])
  }

  interface SeedOrderInput {
    readonly forTenantId: string
    readonly pharmacyId: string
    readonly status: string
    readonly totalAmountTjs: string
    readonly createdAt: Date
    readonly slaDeadlineAt?: Date
    readonly pickedUpAt?: Date
    readonly deliveredAt?: Date
  }

  async function seedOrder(input: SeedOrderInput): Promise<string> {
    const id = randomUUID()
    const customerId = await seedUser('customer')
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address,
          tenant_id, checkout_attempt_id, created_at, sla_deadline_at, picked_up_at, delivered_at)
       VALUES ($1, $2, $3, $4, $5, 'cash_courier', $6, 0.00, $6, 'Dushanbe, test str. 1', $7, $8, $9, $10, $11, $12)`,
      [
        id,
        `TST-${id.slice(0, 8)}`,
        customerId,
        input.pharmacyId,
        input.status,
        input.totalAmountTjs,
        input.forTenantId,
        randomUUID(),
        input.createdAt,
        input.slaDeadlineAt ?? null,
        input.pickedUpAt ?? null,
        input.deliveredAt ?? null,
      ],
    )
    createdOrderIds.push(id)
    return id
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    for (const id of [operatorTenantId, tenantId]) {
      await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
        id,
        `test-platform-metrics-${id.slice(0, 8)}`,
      ])
    }
    ctx = await createTestApp(TEST_DATABASE_URL, TEST_REDIS_URL)
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      if (createdOrderIds.length > 0) {
        await pool.query('DELETE FROM order_items WHERE order_id = ANY($1)', [createdOrderIds])
        await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds])
      }
      if (createdPharmacyIds.length > 0) {
        await pool.query('DELETE FROM inventory_sync_batch WHERE pharmacy_id = ANY($1)', [createdPharmacyIds])
        await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [createdPharmacyIds])
      }
      if (createdChainIds.length > 0) {
        await pool.query('DELETE FROM pharmacy_chains WHERE id = ANY($1)', [createdChainIds])
      }
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[operatorTenantId, tenantId]])
      await pool.end().catch(() => undefined)
    }
  })

  it('АС2 — GMV считается СТРОГО по status=delivered: cancelled/processing НЕ учитываются', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })
    const chainId = await seedPharmacyChainForTenant(tenantId, 'active')
    const pharmacyId = await seedPharmacyForChain(chainId, 'active')
    await seedOrder({
      forTenantId: tenantId,
      pharmacyId,
      status: 'delivered',
      totalAmountTjs: '100.00',
      createdAt: AUGUST_START,
      deliveredAt: AUGUST_START,
    })
    await seedOrder({ forTenantId: tenantId, pharmacyId, status: 'cancelled', totalAmountTjs: '50.00', createdAt: AUGUST_START })
    await seedOrder({ forTenantId: tenantId, pharmacyId, status: 'processing', totalAmountTjs: '30.00', createdAt: AUGUST_START })

    const res = await getPlatformMetrics(token, tenantId, AUGUST_PERIOD)

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<PlatformMetricsBody>).data
    expect(body.gmvDiram).toBe(10_000)
    expect(body.orderCount).toBe(1)
    expect(body.averageCheckDiram).toBe(10_000)
  })

  it('АС3 — период без заказов, по которым измерим SLA → pickupSlaComplianceRate=0, не NaN/исключение', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })
    const emptyTenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      emptyTenantId,
      `test-platform-empty-${emptyTenantId.slice(0, 8)}`,
    ])

    const res = await getPlatformMetrics(token, emptyTenantId, '2020-01')

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<PlatformMetricsBody>).data
    expect(body.pickupSlaComplianceRate).toBe(0)
    expect(body.deliverySlaComplianceRate).toBe(0)
    expect(Number.isNaN(body.pickupSlaComplianceRate)).toBe(false)

    await pool.query('DELETE FROM tenants WHERE id = $1', [emptyTenantId])
  })

  it('TC-ADM-030 — 3 из 8 активных пилотных аптек прислали данные за 7 дней → activePharmaciesSendingDataRate ≈ 0.375', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })
    // Отдельный тенант — иначе знаменатель «активных аптек» растёт чужой аптекой (найдено этим прогоном).
    const pilotTenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      pilotTenantId,
      `test-platform-pilot-${pilotTenantId.slice(0, 8)}`,
    ])
    const chainId = await seedPharmacyChainForTenant(pilotTenantId, 'active')
    const pharmacyIds = await Promise.all(Array.from({ length: 8 }, () => seedPharmacyForChain(chainId, 'active')))
    const recentlySent = pharmacyIds.slice(0, 3)
    const staleOrSilent = pharmacyIds.slice(3)
    for (const id of recentlySent) {
      await seedInventorySyncBatch(id, new Date(Date.now() - MS_PER_DAY))
    }
    // Батч старше 7 дней НЕ должен засчитываться — та же аптека, что «молчит».
    await seedInventorySyncBatch(staleOrSilent[0]!, new Date(Date.now() - 10 * MS_PER_DAY))

    const res = await getPlatformMetrics(token, pilotTenantId, AUGUST_PERIOD)

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<PlatformMetricsBody>).data
    expect(body.activePharmaciesSendingDataRate).toBeCloseTo(0.375)

    await pool.query('DELETE FROM tenants WHERE id = $1', [pilotTenantId])
  })

  it('АС4 — pharmacy_admin → 403 INSUFFICIENT_ROLE (экран исключительно платформенный)', async () => {
    const pharmacyAdminId = await seedUser('pharmacy_admin')
    const token = sign({ sub: pharmacyAdminId, role: 'pharmacy_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })

    const res = await getPlatformMetrics(token, tenantId, AUGUST_PERIOD)

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('невалидный формат period → 400 VALIDATION_ERROR', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })

    const res = await getPlatformMetrics(token, tenantId, 'август-2026')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })
})
