// AnalyticsEventsController — Supertest integration (DTJ-379) против реальных Postgres/Redis.
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, GUEST_TENANT_ID, type TestApp } from './__tests__/analytics-events-test-app.js'

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
  readonly error: { readonly code: string; readonly message?: string }
}
interface ProductEventRow {
  session_id: string
  event_type: string
  user_id: string | null
}

function validEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventType: 'search_performed',
    sessionId: randomUUID(),
    ...overrides,
  }
}

describe.skipIf(!postgresAvailable)('AnalyticsEventsController — Supertest integration (DTJ-379)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const seededSessionIds: string[] = []
  const seededUserIds: string[] = []

  function postEvents(body: readonly Record<string, unknown>[], token?: string): request.Test {
    const req = request(httpServer).post('/api/v1/analytics/events')
    return token === undefined ? req.send(body) : req.set('Authorization', `Bearer ${token}`).send(body)
  }

  async function seedUser(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, 'customer', true)`, [
      id,
      GUEST_TENANT_ID,
      `+99291${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
    ])
    seededUserIds.push(id)
    return id
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      GUEST_TENANT_ID,
      `test-analytics-guest-${GUEST_TENANT_ID.slice(0, 8)}`,
    ])
    ctx = await createTestApp(TEST_DATABASE_URL, TEST_REDIS_URL)
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterEach(async () => {
    if (seededSessionIds.length > 0) {
      await pool.query('DELETE FROM product_events WHERE session_id = ANY($1)', [seededSessionIds])
      seededSessionIds.length = 0
    }
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      if (seededUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [seededUserIds])
      }
      await pool.query('DELETE FROM product_events WHERE tenant_id = $1', [GUEST_TENANT_ID])
      await pool.query('DELETE FROM tenants WHERE id = $1', [GUEST_TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  it('АС4: гость (без Authorization) — 202 Accepted, событие search_performed записано', async () => {
    const sessionId = randomUUID()
    seededSessionIds.push(sessionId)

    const res = await postEvents([validEvent({ eventType: 'search_performed', sessionId })])

    expect(res.status).toBe(202)
    const rows = await pool.query<ProductEventRow>('SELECT session_id, event_type, user_id FROM product_events WHERE session_id = $1', [
      sessionId,
    ])
    expect(rows.rows).toEqual([{ session_id: sessionId, event_type: 'search_performed', user_id: null }])
  })

  it('АС1: батч из 10 валидных событий — 202 Accepted, все 10 строк записаны', async () => {
    const sessionId = randomUUID()
    seededSessionIds.push(sessionId)
    const events = Array.from({ length: 10 }, (_unused, index) =>
      validEvent({ eventType: index % 2 === 0 ? 'search_performed' : 'analog_shown', sessionId }),
    )

    const res = await postEvents(events)

    expect(res.status).toBe(202)
    const rows = await pool.query('SELECT id FROM product_events WHERE session_id = $1', [sessionId])
    expect(rows.rows).toHaveLength(10)
  })

  it('АС2: батч из 51 события — 400 VALIDATION_ERROR, ничего не записано', async () => {
    const sessionId = randomUUID()
    seededSessionIds.push(sessionId)
    const events = Array.from({ length: 51 }, () => validEvent({ sessionId }))

    const res = await postEvents(events)

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    const rows = await pool.query('SELECT id FROM product_events WHERE session_id = $1', [sessionId])
    expect(rows.rows).toHaveLength(0)
  })

  it('АС3: 1 из 5 событий батча с eventType вне известного списка — остальные 4 записаны, невалидный пропущен', async () => {
    const sessionId = randomUUID()
    seededSessionIds.push(sessionId)
    const events = [
      validEvent({ eventType: 'search_performed', sessionId }),
      validEvent({ eventType: 'analog_shown', sessionId }),
      validEvent({ eventType: 'unknown_future_event', sessionId }),
      validEvent({ eventType: 'analog_clicked', sessionId }),
      validEvent({ eventType: 'added_to_cart', sessionId }),
    ]

    const res = await postEvents(events)

    expect(res.status).toBe(202)
    const rows = await pool.query<ProductEventRow>('SELECT event_type FROM product_events WHERE session_id = $1', [sessionId])
    expect(rows.rows).toHaveLength(4)
    expect(rows.rows.map((row) => row.event_type)).not.toContain('unknown_future_event')
  })

  it('аутентифицированный customer — user_id заполнен из JWT, не NULL', async () => {
    const userId = await seedUser()
    const token = jwtSigner.sign({ sub: userId, role: 'customer', tenantId: GUEST_TENANT_ID, pharmacyId: null, chainId: null, sessionId: randomUUID() })
    const sessionId = randomUUID()
    seededSessionIds.push(sessionId)

    const res = await postEvents([validEvent({ eventType: 'added_to_cart', sessionId })], token)

    expect(res.status).toBe(202)
    const rows = await pool.query<ProductEventRow>('SELECT user_id FROM product_events WHERE session_id = $1', [sessionId])
    expect(rows.rows).toEqual([{ user_id: userId }])
  })

  it('невалидный Bearer-токен — 401, не тихий откат к гостю', async () => {
    const res = await postEvents([validEvent()], 'not-a-real-token')

    expect(res.status).toBe(401)
  })
})
