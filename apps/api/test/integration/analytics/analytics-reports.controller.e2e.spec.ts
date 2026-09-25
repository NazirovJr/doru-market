// AnalyticsReportsController — Supertest integration (DTJ-383) против реальных Postgres/Redis.
// Харнесс — тот же createTestApp (analytics-events-test-app.ts), что analytics-dashboard.controller.e2e.spec.ts.
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
interface SuccessBody<T> {
  readonly data: T
}
interface TopAnalogBody {
  readonly medicineId: string
  readonly medicineName: string
  readonly avgSavingsDiram: number
  readonly timesShown: number
  readonly conversionToOrder: number
}

const AUGUST_PERIOD = '2026-08'
const AUGUST_START = new Date('2026-08-15T12:00:00.000Z')
const MS_PER_HOUR = 3_600_000

describe.skipIf(!postgresAvailable)('AnalyticsReportsController.topAnalogs — Supertest integration (DTJ-383)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const tenantId = randomUUID()
  const operatorTenantId = randomUUID()
  const medicineId = randomUUID()
  let categoryId: number
  const createdUserIds: string[] = []

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedUser(role: string): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, $4, true)`, [
      id,
      operatorTenantId,
      `+99294${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
      role,
    ])
    createdUserIds.push(id)
    return id
  }

  function getTopAnalogs(params: { token: string; forTenantId: string; period: string; limit?: number }): request.Test {
    const limitQuery = params.limit === undefined ? '' : `&limit=${String(params.limit)}`
    return request(httpServer)
      .get(`/api/v1/analytics/top-analogs?tenantId=${params.forTenantId}&period=${params.period}${limitQuery}`)
      .set('Authorization', `Bearer ${params.token}`)
  }

  async function seedAnalogShownEvent(sessionId: string, savingsDiram: number): Promise<void> {
    await pool.query(
      `INSERT INTO product_events (tenant_id, session_id, event_type, medicine_id, savings_diram, occurred_at)
       VALUES ($1, $2, 'analog_shown', $3, $4, $5)`,
      [tenantId, sessionId, medicineId, savingsDiram, AUGUST_START],
    )
  }

  async function seedOrderPlacedEvent(sessionId: string): Promise<void> {
    await pool.query(
      `INSERT INTO product_events (tenant_id, session_id, event_type, medicine_id, occurred_at)
       VALUES ($1, $2, 'order_placed', $3, $4)`,
      [tenantId, sessionId, medicineId, new Date(AUGUST_START.getTime() + MS_PER_HOUR)],
    )
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    for (const id of [tenantId, operatorTenantId]) {
      await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
        id,
        `test-analytics-reports-${id.slice(0, 8)}`,
      ])
    }
    const categoryResult = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ($1, 'тадж', 'рус', 'en', 'otc', 0, true) RETURNING id`,
      [`dtj383-${tenantId.slice(0, 8)}`],
    )
    const categoryRow = categoryResult.rows[0]
    if (categoryRow === undefined) throw new Error('seedCategory: no row returned')
    categoryId = categoryRow.id
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, 'Panadol-DTJ383', 'Paracetamol', $2, 'таблетки', 'tablet', '500 мг', 'Tajikistan',
               'Test Pharma', false, 'none', true, false, true)`,
      [medicineId, categoryId],
    )
    ctx = await createTestApp(TEST_DATABASE_URL, TEST_REDIS_URL)
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM product_events WHERE tenant_id = $1', [tenantId])
      await pool.query('DELETE FROM medicines WHERE id = $1', [medicineId])
      await pool.query('DELETE FROM categories WHERE id = $1', [categoryId])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantId, operatorTenantId]])
      await pool.end().catch(() => undefined)
    }
  })

  it('АС1 — 50 показов, 5 с последующим order_placed той же сессии/медикамента → timesShown=50, conversionToOrder=0.10, название обогащено CatalogFacade', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })
    const convertedSessions = Array.from({ length: 5 }, () => randomUUID())
    const otherSessions = Array.from({ length: 45 }, () => randomUUID())
    for (const sessionId of convertedSessions) {
      await seedAnalogShownEvent(sessionId, 2_000)
      await seedOrderPlacedEvent(sessionId)
    }
    for (const sessionId of otherSessions) {
      await seedAnalogShownEvent(sessionId, 2_000)
    }

    const res = await getTopAnalogs({ token, forTenantId: tenantId, period: AUGUST_PERIOD })

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<readonly TopAnalogBody[]>).data
    const row = body.find((item) => item.medicineId === medicineId)
    expect(row?.timesShown).toBe(50)
    expect(row?.medicineName).toBe('Panadol-DTJ383')
    expect(row?.avgSavingsDiram).toBe(2_000)
    expect(row?.conversionToOrder).toBeCloseTo(0.1)
  })

  it('АС2 — limit не передан → дефолт 10 применяется на уровне контракта', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })

    const res = await getTopAnalogs({ token, forTenantId: tenantId, period: AUGUST_PERIOD })

    expect(res.status).toBe(200)
  })

  it('АС3 — период без analog_shown → пустой массив, не ошибка', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })

    const res = await getTopAnalogs({ token, forTenantId: tenantId, period: '2020-01' })

    expect(res.status).toBe(200)
    expect((res.body as SuccessBody<readonly TopAnalogBody[]>).data).toEqual([])
  })

  it('pharmacy_admin → 403 INSUFFICIENT_ROLE (экран исключительно платформенный)', async () => {
    const pharmacyAdminId = await seedUser('pharmacy_admin')
    const token = sign({ sub: pharmacyAdminId, role: 'pharmacy_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })

    const res = await getTopAnalogs({ token, forTenantId: tenantId, period: AUGUST_PERIOD })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('limit=101 (за верхней границей) → 400 VALIDATION_ERROR', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })

    const res = await getTopAnalogs({ token, forTenantId: tenantId, period: AUGUST_PERIOD, limit: 101 })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })
})
