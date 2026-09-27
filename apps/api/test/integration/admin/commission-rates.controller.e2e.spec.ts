// Supertest integration CommissionRatesController против фейкового PAYMENTS_FACADE_PORT (см. JSDoc finance-test-app.ts), DTJ-358.
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/finance-test-app.js'

const TEST_DATABASE_URL =
  process.env.ADMIN_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
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

interface SuccessBody<T> {
  readonly data: T
  readonly meta?: Record<string, unknown>
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string }
}

const VALID_BODY = {
  category: 'rx',
  rateBps: 600,
  effectiveFrom: '2026-10-01',
}

describe.skipIf(!postgresAvailable)('CommissionRatesController — Supertest integration (DTJ-358)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let superAdminToken: string
  let pharmacyAdminToken: string

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  beforeAll(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    superAdminToken = sign({ sub: randomUUID(), role: 'super_admin', tenantId: randomUUID(), pharmacyId: null, chainId: null })
    pharmacyAdminToken = sign({ sub: randomUUID(), role: 'pharmacy_admin', tenantId: randomUUID(), pharmacyId: null, chainId: null })
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('GET /finance/commission-rates → 200, страница с pagination-meta', async () => {
    const res = await request(httpServer).get('/api/v1/finance/commission-rates').set('Authorization', `Bearer ${superAdminToken}`)

    expect(res.status).toBe(200)
    expect((res.body as SuccessBody<unknown>).meta?.pagination).toBeDefined()
  })

  it('АС2 — POST rateBps=15000 (вне 0..10000) → 400 VALIDATION_ERROR', async () => {
    const res = await request(httpServer)
      .post('/api/v1/finance/commission-rates')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ ...VALID_BODY, rateBps: 15_000 })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })

  it('POST невалидная category → 400 VALIDATION_ERROR', async () => {
    const res = await request(httpServer)
      .post('/api/v1/finance/commission-rates')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ ...VALID_BODY, category: 'parapharmacy' })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })

  it('POST effectiveTo <= effectiveFrom → 400 VALIDATION_ERROR', async () => {
    const res = await request(httpServer)
      .post('/api/v1/finance/commission-rates')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ ...VALID_BODY, effectiveTo: '2026-10-01' })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })

  it('POST валидное тело → 201, super_admin', async () => {
    const res = await request(httpServer).post('/api/v1/finance/commission-rates').set('Authorization', `Bearer ${superAdminToken}`).send(VALID_BODY)

    expect(res.status).toBe(201)
    const body = res.body as SuccessBody<{ category: string; rateBps: number }>
    expect(body.data).toEqual(expect.objectContaining({ category: 'rx', rateBps: 600 }))
  })

  it('PATCH /:id валидное тело → 200, super_admin', async () => {
    const res = await request(httpServer)
      .patch(`/api/v1/finance/commission-rates/${randomUUID()}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ ...VALID_BODY, rateBps: 700 })

    expect(res.status).toBe(200)
    expect((res.body as SuccessBody<{ rateBps: number }>).data.rateBps).toBe(700)
  })

  it('АС4 — pharmacy_admin → 403 INSUFFICIENT_ROLE на GET/POST/PATCH', async () => {
    const results = await Promise.all([
      request(httpServer).get('/api/v1/finance/commission-rates').set('Authorization', `Bearer ${pharmacyAdminToken}`),
      request(httpServer).post('/api/v1/finance/commission-rates').set('Authorization', `Bearer ${pharmacyAdminToken}`).send(VALID_BODY),
      request(httpServer)
        .patch(`/api/v1/finance/commission-rates/${randomUUID()}`)
        .set('Authorization', `Bearer ${pharmacyAdminToken}`)
        .send(VALID_BODY),
    ])

    for (const res of results) {
      expect(res.status).toBe(403)
      expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
    }
  })
})
