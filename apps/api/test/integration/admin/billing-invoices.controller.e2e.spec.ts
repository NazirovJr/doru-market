// Supertest integration BillingInvoicesController — тот же приём фейковых портов, что finance-ledger.controller.e2e.spec.ts.
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { JwtClaims } from '@/modules/auth/index.js'
import { createFakeBillingInvoicePorts, type FakeBillingInvoicePorts } from './__tests__/fake-billing-invoice-ports.js'
import { createTestApp, jwtSignerOf, type TestApp } from './__tests__/billing-invoices-test-app.js'

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
interface InvoiceBody {
  readonly id: string
  readonly chainId: string
  readonly chainName: string | null
  readonly status: string
  readonly paidAt: string | null
}

const CHAIN_A = randomUUID()
const CHAIN_B = randomUUID()
const INVOICE_ISSUED = randomUUID()
const INVOICE_PAID = randomUUID()
const INVOICE_DRAFT = randomUUID()

describe.skipIf(!postgresAvailable)('BillingInvoicesController — Supertest integration (DTJ-359)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let ports: FakeBillingInvoicePorts
  let superAdminId: string
  let superAdminToken: string
  let pharmacyAdminToken: string

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSignerOf(app).sign({ ...claims, sessionId: randomUUID() })
  }

  beforeAll(async () => {
    ports = createFakeBillingInvoicePorts([
      { id: INVOICE_ISSUED, chainId: CHAIN_A, status: 'issued' },
      { id: INVOICE_PAID, chainId: CHAIN_B, status: 'paid' },
      { id: INVOICE_DRAFT, chainId: CHAIN_A, status: 'draft' },
    ])
    ctx = await createTestApp(ports)
    app = ctx.app
    httpServer = ctx.httpServer
    superAdminId = randomUUID()
    superAdminToken = sign({ sub: superAdminId, role: 'super_admin', tenantId: randomUUID(), pharmacyId: null, chainId: null })
    pharmacyAdminToken = sign({ sub: randomUUID(), role: 'pharmacy_admin', tenantId: randomUUID(), pharmacyId: null, chainId: null })
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('GET /finance/billing-invoices?filter[chainId]=X → 200, только инвойсы этой сети, chainName догружен', async () => {
    const res = await request(httpServer)
      .get(`/api/v1/finance/billing-invoices?filter[chainId]=${CHAIN_A}`)
      .set('Authorization', `Bearer ${superAdminToken}`)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly InvoiceBody[]>
    expect(body.data.every((item) => item.chainId === CHAIN_A)).toBe(true)
    expect(body.data.find((item) => item.id === INVOICE_ISSUED)?.chainName).toBe(`Chain ${CHAIN_A}`)
    expect(body.meta?.pagination).toBeDefined()
  })

  it('POST /finance/billing-invoices/:id/mark-paid → 200, статус paid', async () => {
    const res = await request(httpServer)
      .post(`/api/v1/finance/billing-invoices/${INVOICE_ISSUED}/mark-paid`)
      .set('Authorization', `Bearer ${superAdminToken}`)

    expect(res.status).toBe(200)
    expect((res.body as SuccessBody<InvoiceBody>).data.status).toBe('paid')
  })

  it('АС4 — повторный POST mark-paid на уже paid инвойс → 409 CONFLICT', async () => {
    const res = await request(httpServer)
      .post(`/api/v1/finance/billing-invoices/${INVOICE_PAID}/mark-paid`)
      .set('Authorization', `Bearer ${superAdminToken}`)

    expect(res.status).toBe(409)
    expect((res.body as ErrorBody).error.code).toBe('CONFLICT')
  })

  it('POST mark-paid на несуществующий инвойс → 404 NOT_FOUND', async () => {
    const res = await request(httpServer)
      .post(`/api/v1/finance/billing-invoices/${randomUUID()}/mark-paid`)
      .set('Authorization', `Bearer ${superAdminToken}`)

    expect(res.status).toBe(404)
  })

  it('АС2 — POST lift-block без reason → 400 VALIDATION_ERROR, liftInvoiceBlock не вызывается', async () => {
    const res = await request(httpServer)
      .post(`/api/v1/finance/billing-invoices/${INVOICE_DRAFT}/lift-block`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({})

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    expect(ports.liftInvoiceBlockCalls).toHaveLength(0)
  })

  it('АС3 — валидный POST lift-block → 200, liftInvoiceBlock вызван с chainId инвойса, audit_log записан', async () => {
    const res = await request(httpServer)
      .post(`/api/v1/finance/billing-invoices/${INVOICE_DRAFT}/lift-block`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ reason: 'invoice paid by bank transfer, confirmed' })

    expect(res.status).toBe(200)
    expect(ports.liftInvoiceBlockCalls).toEqual([{ chainId: CHAIN_A, actorUserId: superAdminId }])
    expect(ports.auditEntries.some((e) => e.category === 'ledger_adjustment' && e.action === 'lift_invoice_block')).toBe(true)
  })

  it('pharmacy_admin → 403 INSUFFICIENT_ROLE на всех трёх маршрутах', async () => {
    const results = await Promise.all([
      request(httpServer).get('/api/v1/finance/billing-invoices').set('Authorization', `Bearer ${pharmacyAdminToken}`),
      request(httpServer).post(`/api/v1/finance/billing-invoices/${INVOICE_ISSUED}/mark-paid`).set('Authorization', `Bearer ${pharmacyAdminToken}`),
      request(httpServer)
        .post(`/api/v1/finance/billing-invoices/${INVOICE_ISSUED}/lift-block`)
        .set('Authorization', `Bearer ${pharmacyAdminToken}`)
        .send({ reason: 'valid enough reason text' }),
    ])

    for (const res of results) {
      expect(res.status).toBe(403)
      expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
    }
  })
})
