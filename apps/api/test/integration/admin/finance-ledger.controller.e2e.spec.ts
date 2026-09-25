// Supertest integration FinanceLedgerController против реального Postgres/Redis (только для
// бутстрапа AuthModule — см. JSDoc __tests__/finance-test-app.ts), DTJ-357.
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/finance-test-app.js'
import { ALERTED_ORDER_ID } from './__tests__/fake-audit-log-query-port.js'

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

describe.skipIf(!postgresAvailable)('FinanceLedgerController — Supertest integration (DTJ-357)', () => {
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

  it('АС1 — GET /finance/escrow-ledger?filter[orderId]=X → 200, записи заказа X', async () => {
    const res = await request(httpServer)
      .get('/api/v1/finance/escrow-ledger?filter[orderId]=order-x')
      .set('Authorization', `Bearer ${superAdminToken}`)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly { orderId: string }[]>
    expect(body.data.every((entry) => entry.orderId === 'order-x')).toBe(true)
  })

  it('GET /finance/payout-schedule?filter[status]=due → 200, страница с pagination-meta', async () => {
    const res = await request(httpServer)
      .get('/api/v1/finance/payout-schedule?filter[status]=due')
      .set('Authorization', `Bearer ${superAdminToken}`)

    expect(res.status).toBe(200)
    expect((res.body as SuccessBody<unknown>).meta?.pagination).toBeDefined()
  })

  it('АС2 — GET /finance/reconciliation-alerts → 200, заказ Y с суммой расхождения', async () => {
    const res = await request(httpServer).get('/api/v1/finance/reconciliation-alerts').set('Authorization', `Bearer ${superAdminToken}`)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly { orderId: string; discrepancyDiram: number }[]>
    expect(body.data).toEqual([expect.objectContaining({ orderId: ALERTED_ORDER_ID, discrepancyDiram: 500 })])
  })

  it('pharmacy_admin → 403 INSUFFICIENT_ROLE на всех трёх маршрутах', async () => {
    const results = await Promise.all(
      ['/api/v1/finance/escrow-ledger', '/api/v1/finance/payout-schedule', '/api/v1/finance/reconciliation-alerts'].map((path) =>
        request(httpServer).get(path).set('Authorization', `Bearer ${pharmacyAdminToken}`),
      ),
    )

    for (const res of results) {
      expect(res.status).toBe(403)
      expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
    }
  })

  it('АС3 — POST/PATCH/DELETE на любой из трёх путей физически не зарегистрированы → 404', async () => {
    const results = await Promise.all([
      request(httpServer).post('/api/v1/finance/escrow-ledger').set('Authorization', `Bearer ${superAdminToken}`),
      request(httpServer).patch('/api/v1/finance/payout-schedule').set('Authorization', `Bearer ${superAdminToken}`),
      request(httpServer).delete('/api/v1/finance/reconciliation-alerts').set('Authorization', `Bearer ${superAdminToken}`),
    ])

    for (const res of results) {
      expect(res.status).toBe(404)
    }
  })
})
