// Supertest integration OrdersAdminActionsController против реальных Postgres/Redis (DTJ-356). Заказы сеются напрямую SQL.
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/orders-test-app.js'

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

interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string; readonly details?: Record<string, unknown> }
}
interface OrderRow {
  readonly status: string
}
interface AuditRow {
  readonly category: string
  readonly actor_user_id: string | null
  readonly reason: string | null
  readonly metadata: Record<string, unknown>
}

let orderNumberSeq = 0
function nextOrderNumber(): string {
  orderNumberSeq += 1
  return `DTJ-260927-9${String(orderNumberSeq).padStart(4, '0')}`
}

describe.skipIf(!postgresAvailable)('OrdersAdminActionsController — Supertest integration (DTJ-356)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const createdOrderIds: string[] = []
  const createdUserIds: string[] = []
  const createdPharmacyIds: string[] = []
  const createdTenantIds: string[] = []

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedTenant(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [id, `dtj356-${id.slice(0, 8)}`])
    createdTenantIds.push(id)
    return id
  }

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, NULL, $2, 'Dushanbe, test str. 356', 38.5598, 68.7870, '+992900000356', 'active')`,
      [id, `Pharmacy ${id.slice(0, 8)}`],
    )
    createdPharmacyIds.push(id)
    return id
  }

  async function seedCustomer(tenantId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, 'customer', true)`, [
      id,
      tenantId,
      `+99293${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
    ])
    createdUserIds.push(id)
    return id
  }

  interface SeedOrderParams {
    readonly tenantId: string
    readonly pharmacyId: string
    readonly customerId: string
    readonly status?: string
    readonly paymentMethod?: 'alif_mobi' | 'cash_courier'
  }

  async function seedOrder(params: SeedOrderParams): Promise<string> {
    const id = randomUUID()
    const paymentMethod = params.paymentMethod ?? 'alif_mobi'
    const status = params.status ?? 'pending_payment'
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, items_total_tjs, delivery_fee_tjs,
          total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, $5, $6, 100.00, 0.00, 100.00, 'x', $7, $8)`,
      [id, nextOrderNumber(), params.customerId, params.pharmacyId, paymentMethod, status, params.tenantId, randomUUID()],
    )
    createdOrderIds.push(id)
    return id
  }

  function postPaymentOverride(token: string, id: string, body: Record<string, unknown>): request.Test {
    return request(httpServer).post(`/api/v1/admin/orders/${id}/payment-override`).set('Authorization', `Bearer ${token}`).send(body)
  }

  function postForceCancel(token: string, id: string, body: Record<string, unknown>): request.Test {
    return request(httpServer).post(`/api/v1/admin/orders/${id}/admin-force-cancel`).set('Authorization', `Bearer ${token}`).send(body)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      // audit_log/escrow_ledger — append-only (app_role/test не имеют DELETE), строки не чистим, как и соседние admin-спеки.
      if (createdOrderIds.length > 0) {
        await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds])
      }
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      if (createdPharmacyIds.length > 0) {
        await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [createdPharmacyIds])
      }
      if (createdTenantIds.length > 0) {
        await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [createdTenantIds])
      }
      await pool.end().catch(() => undefined)
    }
  })

  it('АС1 DTJ-356 — payment-override с reason короче 10 символов → 400 VALIDATION_ERROR, статус НЕ изменён, audit_log пуст', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy()
    const customerId = await seedCustomer(tenantId)
    const orderId = await seedOrder({ tenantId, pharmacyId, customerId, status: 'pending_payment' })
    const superAdminToken = sign({ sub: randomUUID(), role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })

    const res = await postPaymentOverride(superAdminToken, orderId, {
      reason: 'коротко',
      txId: 'manual-tx-1',
      amountDiram: '10000',
      paidAt: new Date().toISOString(),
    })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    const order = await pool.query<OrderRow>('SELECT status FROM orders WHERE id = $1', [orderId])
    expect(order.rows[0]?.status).toBe('pending_payment')
    const audit = await pool.query(`SELECT id FROM audit_log WHERE entity_id = $1`, [orderId])
    expect(audit.rows).toHaveLength(0)
  })

  it('АС2 DTJ-356 — валидный payment-override: статус → paid_escrow, audit_log(category=payment_override) с before/after/orderTotalDiram', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy()
    const customerId = await seedCustomer(tenantId)
    const orderId = await seedOrder({ tenantId, pharmacyId, customerId, status: 'pending_payment' })
    const superAdminId = randomUUID()
    const superAdminToken = sign({ sub: superAdminId, role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })

    const res = await postPaymentOverride(superAdminToken, orderId, {
      reason: 'банк подтвердил оплату по телефону поддержки, ref #12345',
      txId: `manual-tx-${orderId.slice(0, 8)}`,
      amountDiram: '10000',
      paidAt: new Date().toISOString(),
    })

    expect(res.status).toBe(200)
    const order = await pool.query<OrderRow>('SELECT status FROM orders WHERE id = $1', [orderId])
    expect(order.rows[0]?.status).toBe('paid_escrow')
    const audit = await pool.query<AuditRow>(
      `SELECT category, actor_user_id, reason, metadata FROM audit_log WHERE entity_id = $1 AND category = 'payment_override'`,
      [orderId],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]?.actor_user_id).toBe(superAdminId)
    expect(audit.rows[0]?.metadata).toMatchObject({ before: { status: 'pending_payment' }, after: { status: 'paid_escrow' } })
  })

  it('АС3 DTJ-356 — admin-force-cancel на delivered-заказе → 422 BUSINESS_RULE_VIOLATION, статус не меняется, audit_log пуст', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy()
    const customerId = await seedCustomer(tenantId)
    const orderId = await seedOrder({ tenantId, pharmacyId, customerId, status: 'delivered' })
    const superAdminToken = sign({ sub: randomUUID(), role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })

    const res = await postForceCancel(superAdminToken, orderId, { reason: 'обнаружена поддельная лицензия рецепта, инцидент INC-2044' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.code).toBe('BUSINESS_RULE_VIOLATION')
    const order = await pool.query<OrderRow>('SELECT status FROM orders WHERE id = $1', [orderId])
    expect(order.rows[0]?.status).toBe('delivered')
    const audit = await pool.query(`SELECT id FROM audit_log WHERE entity_id = $1 AND category = 'force_cancel_order'`, [orderId])
    expect(audit.rows).toHaveLength(0)
  })

  it('валидный admin-force-cancel из processing: статус → cancelled, audit_log(category=force_cancel_order) создан', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy()
    const customerId = await seedCustomer(tenantId)
    const orderId = await seedOrder({ tenantId, pharmacyId, customerId, status: 'processing', paymentMethod: 'cash_courier' })
    const superAdminId = randomUUID()
    const superAdminToken = sign({ sub: superAdminId, role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })

    const res = await postForceCancel(superAdminToken, orderId, { reason: 'обнаружена поддельная лицензия рецепта, инцидент INC-2050' })

    expect(res.status).toBe(200)
    const order = await pool.query<OrderRow>('SELECT status FROM orders WHERE id = $1', [orderId])
    expect(order.rows[0]?.status).toBe('cancelled')
    const audit = await pool.query<AuditRow>(
      `SELECT category, actor_user_id FROM audit_log WHERE entity_id = $1 AND category = 'force_cancel_order'`,
      [orderId],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]?.actor_user_id).toBe(superAdminId)
  })

  it('pharmacy_admin → 403 INSUFFICIENT_ROLE на обоих маршрутах (только super_admin)', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy()
    const customerId = await seedCustomer(tenantId)
    const orderId = await seedOrder({ tenantId, pharmacyId, customerId })
    const pharmacyAdminToken = sign({ sub: randomUUID(), role: 'pharmacy_admin', tenantId, pharmacyId: null, chainId: null })

    const overrideRes = await postPaymentOverride(pharmacyAdminToken, orderId, {
      reason: 'валидная причина длиной более 10 символов',
      txId: 'x',
      amountDiram: '100',
      paidAt: new Date().toISOString(),
    })
    const cancelRes = await postForceCancel(pharmacyAdminToken, orderId, { reason: 'валидная причина длиной более 10 символов' })

    expect(overrideRes.status).toBe(403)
    expect((overrideRes.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
    expect(cancelRes.status).toBe(403)
    expect((cancelRes.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })
})
