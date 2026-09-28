// Supertest integration ReportExportController против реального Postgres/Redis/BullMQ (DTJ-361, AC1/AC2/AC4).
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/report-export-test-app.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test_dtj361'
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
}
interface ErrorBody {
  readonly error: { readonly code: string }
}

const TEST_TENANT_ID = randomUUID()

describe.skipIf(!postgresAvailable)('ReportExportController — Supertest integration (DTJ-361)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let userId: string
  let token: string
  const createdUserIds: string[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)

    userId = randomUUID()
    await pool.query('INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, $3)', [userId, TEST_TENANT_ID, 'super_admin'])
    createdUserIds.push(userId)
    token = jwtSigner.sign({
      sub: userId,
      role: 'super_admin',
      tenantId: TEST_TENANT_ID,
      pharmacyId: null,
      chainId: null,
      sessionId: randomUUID(),
    })
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM export_jobs WHERE requested_by = ANY($1)', [createdUserIds])
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.end().catch(() => undefined)
    }
  })

  it('AC1: period 20 дней → синхронный 200, Content-Disposition attachment, файл содержит данные, БЕЗ записи в export_jobs', async () => {
    const res = await request(httpServer)
      .post('/api/v1/reports/top-analogs/export?format=csv')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodDays: 20, params: {}, rows: [{ name: 'Панадол' }], columns: [{ key: 'name', header: 'Название' }] })

    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.text).toContain('Панадол')

    const rows = await pool.query('SELECT id FROM export_jobs WHERE report_type = $1', ['top-analogs'])
    expect(rows.rows).toHaveLength(0)
  })

  it('AC2: period 45 дней → 202 {exportJobId}, запись в export_jobs.status=processing создана немедленно', async () => {
    const res = await request(httpServer)
      .post('/api/v1/reports/pharmacy-sales/export?format=csv')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodDays: 45, params: { pharmacyId: 'ph-1' } })

    expect(res.status).toBe(202)
    const exportJobId = (res.body as SuccessBody<{ exportJobId: string }>).data.exportJobId
    expect(typeof exportJobId).toBe('string')

    const row = await pool.query('SELECT status FROM export_jobs WHERE id = $1', [exportJobId])
    expect(row.rows).toHaveLength(1)
    expect((row.rows[0] as { status: string }).status).toBe('processing')

    const statusRes = await request(httpServer).get(`/api/v1/reports/export-jobs/${exportJobId}`).set('Authorization', `Bearer ${token}`)
    expect(statusRes.status).toBe(200)
    expect((statusRes.body as SuccessBody<{ status: string }>).data.status).toBe('processing')
  })

  it('AC4: GET export-jobs/:id для несуществующего id → 404 NOT_FOUND', async () => {
    const res = await request(httpServer).get(`/api/v1/reports/export-jobs/${randomUUID()}`).set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })
})
