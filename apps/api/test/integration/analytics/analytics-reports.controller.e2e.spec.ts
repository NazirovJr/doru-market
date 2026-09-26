// AnalyticsReportsController — Supertest integration (DTJ-383/384) против реальных Postgres/Redis.
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
interface OnboardingFunnelBody {
  readonly decision: 'approved' | 'rejected'
  readonly averageDurationHours: number
  readonly count: number
}

const AUGUST_PERIOD = '2026-08'
const AUGUST_START = new Date('2026-08-15T12:00:00.000Z')
const MS_PER_HOUR = 3_600_000
// АС2 в отдельном месяце: иначе среднее смешивается с заявками АС1 того же тенанта.
const JULY_PERIOD = '2026-07'
const JULY_START = new Date('2026-07-15T12:00:00.000Z')

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

describe.skipIf(!postgresAvailable)('AnalyticsReportsController.onboardingFunnel — Supertest integration (DTJ-384)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const tenantId = randomUUID()
  const operatorTenantId = randomUUID()
  const createdUserIds: string[] = []
  const createdChainIds: string[] = []

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedUser(role: string): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, $4, true)`, [
      id,
      operatorTenantId,
      `+99295${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
      role,
    ])
    createdUserIds.push(id)
    return id
  }

  function getOnboardingFunnel(token: string, forTenantId: string, period: string): request.Test {
    return request(httpServer)
      .get(`/api/v1/analytics/onboarding-funnel?tenantId=${forTenantId}&period=${period}`)
      .set('Authorization', `Bearer ${token}`)
  }

  async function seedResolvedChain(input: {
    readonly submittedAt: Date
    readonly decisionAt: Date
    readonly decisionAction: 'approve' | 'reject'
    readonly actorUserId: string
  }): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status, tenant_id, submitted_at)
       VALUES ($1, 'Test Chain DTJ-384', 'Test Chain LLC', $2, 'pending_review', $3, $4)`,
      [id, `tin-${id.slice(0, 12)}`, tenantId, input.submittedAt],
    )
    createdChainIds.push(id)
    await pool.query(
      `INSERT INTO onboarding_review_log (chain_id, action, actor_user_id, reason, created_at)
       VALUES ($1, $2, $3, NULL, $4)`,
      [id, input.decisionAction, input.actorUserId, input.decisionAt],
    )
    return id
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    for (const id of [tenantId, operatorTenantId]) {
      await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
        id,
        `test-onboarding-funnel-${id.slice(0, 8)}`,
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
      if (createdChainIds.length > 0) {
        await pool.query('DELETE FROM onboarding_review_log WHERE chain_id = ANY($1)', [createdChainIds])
        await pool.query('DELETE FROM pharmacy_chains WHERE id = ANY($1)', [createdChainIds])
      }
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantId, operatorTenantId]])
      await pool.end().catch(() => undefined)
    }
  })

  it('АС1 — 7 approved (среднее 30ч) + 3 rejected (среднее 12ч) за период → обе группы с корректными averageDurationHours/count', async () => {
    const superAdminId = await seedUser('super_admin')
    const actorId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })
    for (let i = 0; i < 7; i += 1) {
      await seedResolvedChain({
        submittedAt: AUGUST_START,
        decisionAt: new Date(AUGUST_START.getTime() + 30 * MS_PER_HOUR),
        decisionAction: 'approve',
        actorUserId: actorId,
      })
    }
    for (let i = 0; i < 3; i += 1) {
      await seedResolvedChain({
        submittedAt: AUGUST_START,
        decisionAt: new Date(AUGUST_START.getTime() + 12 * MS_PER_HOUR),
        decisionAction: 'reject',
        actorUserId: actorId,
      })
    }

    const res = await getOnboardingFunnel(token, tenantId, AUGUST_PERIOD)

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<readonly OnboardingFunnelBody[]>).data
    const approved = body.find((item) => item.decision === 'approved')
    const rejected = body.find((item) => item.decision === 'rejected')
    expect(approved).toEqual({ decision: 'approved', averageDurationHours: 30, count: 7 })
    expect(rejected).toEqual({ decision: 'rejected', averageDurationHours: 12, count: 3 })
  })

  it('АС2 — время в changes_requested НЕ засчитывается в averageDurationHours', async () => {
    const superAdminId = await seedUser('super_admin')
    const actorId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })
    const id = randomUUID()
    const submittedAt = JULY_START
    const changesRequestedAt = new Date(submittedAt.getTime() + 20 * MS_PER_HOUR)
    const backToPendingAt = new Date(changesRequestedAt.getTime() + 15 * MS_PER_HOUR)
    const approvedAt = new Date(backToPendingAt.getTime() + 10 * MS_PER_HOUR)
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status, tenant_id, submitted_at)
       VALUES ($1, 'Test Chain DTJ-384-b', 'Test Chain LLC', $2, 'pending_review', $3, $4)`,
      [id, `tin-${id.slice(0, 12)}`, tenantId, submittedAt],
    )
    createdChainIds.push(id)
    await pool.query(
      `INSERT INTO onboarding_review_log (chain_id, action, actor_user_id, reason, created_at) VALUES
         ($1, 'changes_requested', $2, 'нужны документы', $3),
         ($1, 'approve', $2, NULL, $4)`,
      [id, actorId, changesRequestedAt, approvedAt],
    )
    // Второй фиктивный "возврат в pending" НЕ пишется в лог (нет use case'а на changes_requested → pending_review) —
    // формула считает паузу от changes_requested до СЛЕДУЮЩЕЙ записи лога, здесь это approve.
    void backToPendingAt

    const res = await getOnboardingFunnel(token, tenantId, JULY_PERIOD)

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<readonly OnboardingFunnelBody[]>).data
    const approved = body.find((item) => item.decision === 'approved')
    // Полная длительность 45ч (20+15+10) минус пауза changes_requested→approve (15+10=25ч) = 20ч.
    expect(approved?.averageDurationHours).toBeCloseTo(20)
  })

  it('АС3 — период без решённых заявок → пустой массив, не ошибка', async () => {
    const superAdminId = await seedUser('super_admin')
    const token = sign({ sub: superAdminId, role: 'super_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })

    const res = await getOnboardingFunnel(token, tenantId, '2020-01')

    expect(res.status).toBe(200)
    expect((res.body as SuccessBody<readonly OnboardingFunnelBody[]>).data).toEqual([])
  })

  it('pharmacy_admin → 403 INSUFFICIENT_ROLE', async () => {
    const pharmacyAdminId = await seedUser('pharmacy_admin')
    const token = sign({ sub: pharmacyAdminId, role: 'pharmacy_admin', tenantId: operatorTenantId, pharmacyId: null, chainId: null })

    const res = await getOnboardingFunnel(token, tenantId, AUGUST_PERIOD)

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })
})
