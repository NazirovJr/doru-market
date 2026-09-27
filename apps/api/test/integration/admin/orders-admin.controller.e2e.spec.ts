// Supertest integration OrdersAdminController против реальных Postgres/Redis. Заказы сеются напрямую SQL.
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

interface SuccessBody<T> {
  readonly data: T
  readonly meta?: Record<string, unknown>
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string; readonly details?: Record<string, unknown> }
}
interface OrderSummaryBody {
  readonly id: string
  readonly orderNumber: string
  readonly status: string
  readonly tenantId: string
  readonly pharmacyId: string | null
  readonly slaBreached: boolean
}
interface OrderDetailBody extends OrderSummaryBody {
  readonly escrowLedger: readonly unknown[] | null
  readonly payoutSchedule: unknown
  readonly timeline: { readonly processingStartedAt: string | null }
}

let orderNumberSeq = 0
function nextOrderNumber(): string {
  orderNumberSeq += 1
  return `DTJ-260927-${String(orderNumberSeq).padStart(5, '0')}`
}

describe.skipIf(!postgresAvailable)('OrdersAdminController — Supertest integration (DTJ-355/363)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const createdOrderIds: string[] = []
  const createdUserIds: string[] = []
  const createdPharmacyIds: string[] = []
  const createdChainIds: string[] = []
  const createdTenantIds: string[] = []

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedTenant(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [id, `dtj355-${id.slice(0, 8)}`])
    createdTenantIds.push(id)
    return id
  }

  async function seedChain(name: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status) VALUES ($1, $2, $3, $4, 'active')`,
      [id, name, `${name} LLC`, `TIN-DTJ355-${randomUUID().slice(0, 8)}`],
    )
    createdChainIds.push(id)
    return id
  }

  async function seedPharmacy(chainId: string | null, name: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, $3, 'Dushanbe, test str. 355', 38.5598, 68.7870, '+992900000355', 'active')`,
      [id, chainId, name],
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
    readonly totalAmountTjs?: string
    readonly slaDeadlineAt?: Date | null
    readonly orderNumber?: string
  }

  async function seedOrder(params: SeedOrderParams): Promise<{ id: string; orderNumber: string }> {
    const id = randomUUID()
    const orderNumber = params.orderNumber ?? nextOrderNumber()
    const amount = params.totalAmountTjs ?? '100.00'
    const paymentMethod = params.paymentMethod ?? 'alif_mobi'
    // status='confirmed' достижим только для cash_courier (SRS-ORD-028) — дефолт зависит от paymentMethod.
    const status = params.status ?? (paymentMethod === 'cash_courier' ? 'confirmed' : 'pending_payment')
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, items_total_tjs, delivery_fee_tjs,
          total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id, sla_deadline_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0.00, $7, 'x', $8, $9, $10)`,
      [id, orderNumber, params.customerId, params.pharmacyId, paymentMethod, status, amount, params.tenantId, randomUUID(), params.slaDeadlineAt ?? null],
    )
    createdOrderIds.push(id)
    return { id, orderNumber }
  }

  function getOrders(token: string, qs = ''): request.Test {
    return request(httpServer).get(`/api/v1/admin/orders?limit=50${qs}`).set('Authorization', `Bearer ${token}`)
  }

  function getOrderDetail(token: string, id: string): request.Test {
    return request(httpServer).get(`/api/v1/admin/orders/${id}`).set('Authorization', `Bearer ${token}`)
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
      if (createdOrderIds.length > 0) {
        await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds])
      }
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      if (createdPharmacyIds.length > 0) {
        await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [createdPharmacyIds])
      }
      if (createdChainIds.length > 0) {
        await pool.query('DELETE FROM pharmacy_chains WHERE id = ANY($1)', [createdChainIds])
      }
      if (createdTenantIds.length > 0) {
        await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [createdTenantIds])
      }
      await pool.end().catch(() => undefined)
    }
  })

  it('АС2/АС3 DTJ-355 — super_admin находит заказ ЧУЖОГО тенанта по точному filter[orderNumber], без 403', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy(null, `Pharmacy ${randomUUID().slice(0, 8)}`)
    const customerId = await seedCustomer(tenantId)
    const { id, orderNumber } = await seedOrder({ tenantId, pharmacyId, customerId })
    const superAdminToken = sign({ sub: randomUUID(), role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })

    const res = await getOrders(superAdminToken, `&filter[orderNumber]=${orderNumber}`)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly OrderSummaryBody[]>
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.id).toBe(id)
    expect(body.data[0]?.tenantId).toBe(tenantId)
  })

  it('АС3 DTJ-355 — filter[orderNumber] несуществующего номера → data: [], не 404', async () => {
    const superAdminToken = sign({ sub: randomUUID(), role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })

    const res = await getOrders(superAdminToken, `&filter[orderNumber]=DTJ-000101-99999`)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly OrderSummaryBody[]>
    expect(body.data).toEqual([])
  })

  it('АС4 DTJ-355 — pharmacist без scope → 403 INSUFFICIENT_ROLE (маршрут физически недоступен роли)', async () => {
    const res = await getOrders(sign({ sub: randomUUID(), role: 'pharmacist', tenantId: null, pharmacyId: null, chainId: null }))

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('АС2 DTJ-355 — GET /orders/:id для super_admin возвращает 200 для ЛЮБОГО тенанта, без проверки принадлежности', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy(null, `Pharmacy ${randomUUID().slice(0, 8)}`)
    const customerId = await seedCustomer(tenantId)
    const { id } = await seedOrder({ tenantId, pharmacyId, customerId, paymentMethod: 'cash_courier' })
    const superAdminToken = sign({ sub: randomUUID(), role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })

    const res = await getOrderDetail(superAdminToken, id)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<OrderDetailBody>
    expect(body.data.id).toBe(id)
  })

  it('DoD DTJ-355 — cash_courier: escrowLedger/payoutSchedule = null (эскроу не применяется), не пустой массив без объяснения', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy(null, `Pharmacy ${randomUUID().slice(0, 8)}`)
    const customerId = await seedCustomer(tenantId)
    const { id } = await seedOrder({ tenantId, pharmacyId, customerId, paymentMethod: 'cash_courier' })
    const superAdminToken = sign({ sub: randomUUID(), role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })

    const res = await getOrderDetail(superAdminToken, id)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<OrderDetailBody>
    expect(body.data.escrowLedger).toBeNull()
    expect(body.data.payoutSchedule).toBeNull()
  })

  it('GET /orders/:id — customer (роль вне {super_admin, pharmacy_admin}) → 403 INSUFFICIENT_ROLE', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy(null, `Pharmacy ${randomUUID().slice(0, 8)}`)
    const customerId = await seedCustomer(tenantId)
    const { id } = await seedOrder({ tenantId, pharmacyId, customerId })
    const customerToken = sign({ sub: randomUUID(), role: 'customer', tenantId, pharmacyId: null, chainId: null })

    const res = await getOrderDetail(customerToken, id)

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('DTJ-363 — GET /orders/:id: pharmacy_admin СВОЕЙ сети → 200, READ-ONLY карточка', async () => {
    const tenantId = await seedTenant()
    const chainId = await seedChain(`Detail Own Chain ${randomUUID().slice(0, 8)}`)
    const pharmacyId = await seedPharmacy(chainId, `Detail Own Pharmacy ${randomUUID().slice(0, 8)}`)
    const customerId = await seedCustomer(tenantId)
    const { id } = await seedOrder({ tenantId, pharmacyId, customerId })
    const ownAdminToken = sign({ sub: randomUUID(), role: 'pharmacy_admin', tenantId, pharmacyId: null, chainId })

    const res = await getOrderDetail(ownAdminToken, id)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<OrderDetailBody>
    expect(body.data.id).toBe(id)
  })

  it('DTJ-363 — GET /orders/:id: pharmacy_admin ЧУЖОЙ сети → 403 CROSS_TENANT_ACCESS_DENIED', async () => {
    const tenantId = await seedTenant()
    const chainAId = await seedChain(`Detail Chain A ${randomUUID().slice(0, 8)}`)
    const chainBId = await seedChain(`Detail Chain B ${randomUUID().slice(0, 8)}`)
    const pharmacyBId = await seedPharmacy(chainBId, `Detail Pharmacy B ${randomUUID().slice(0, 8)}`)
    const customerId = await seedCustomer(tenantId)
    const { id } = await seedOrder({ tenantId, pharmacyId: pharmacyBId, customerId })
    const foreignAdminToken = sign({ sub: randomUUID(), role: 'pharmacy_admin', tenantId, pharmacyId: null, chainId: chainAId })

    const res = await getOrderDetail(foreignAdminToken, id)

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('CROSS_TENANT_ACCESS_DENIED')
  })

  it('АС1 DTJ-363 — pharmacy_admin сети A видит ТОЛЬКО заказы своих 2 точек, не заказы сети B', async () => {
    const tenantId = await seedTenant()
    const chainAId = await seedChain(`Own Chain A ${randomUUID().slice(0, 8)}`)
    const chainBId = await seedChain(`Own Chain B ${randomUUID().slice(0, 8)}`)
    const pharmacyA1 = await seedPharmacy(chainAId, `A1 ${randomUUID().slice(0, 8)}`)
    const pharmacyA2 = await seedPharmacy(chainAId, `A2 ${randomUUID().slice(0, 8)}`)
    const pharmacyB = await seedPharmacy(chainBId, `B ${randomUUID().slice(0, 8)}`)
    const customerId = await seedCustomer(tenantId)
    const ownOrder1 = await seedOrder({ tenantId, pharmacyId: pharmacyA1, customerId })
    const ownOrder2 = await seedOrder({ tenantId, pharmacyId: pharmacyA2, customerId })
    const foreignOrder = await seedOrder({ tenantId, pharmacyId: pharmacyB, customerId })
    const ownAdminToken = sign({ sub: randomUUID(), role: 'pharmacy_admin', tenantId, pharmacyId: null, chainId: chainAId })

    const res = await getOrders(ownAdminToken, '&scope=own')

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly OrderSummaryBody[]>
    const ids = body.data.map((o) => o.id)
    expect(ids).toContain(ownOrder1.id)
    expect(ids).toContain(ownOrder2.id)
    expect(ids).not.toContain(foreignOrder.id)
  })

  it('АС3 DTJ-363 — customer вызывает scope=own → 403 INSUFFICIENT_ROLE (эндпоинт недоступен клиентской роли)', async () => {
    const res = await getOrders(sign({ sub: randomUUID(), role: 'customer', tenantId: null, pharmacyId: null, chainId: null }), '&scope=own')

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('§«Что сделать» п.3 DTJ-363 — super_admin со scope=own получает ПУСТОЙ список, не ошибку', async () => {
    const superAdminToken = sign({ sub: randomUUID(), role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })

    const res = await getOrders(superAdminToken, '&scope=own')

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly OrderSummaryBody[]>
    expect(body.data).toEqual([])
  })

  it('АС2 DTJ-363 — filter[slaBreached]=true включает processing с истёкшим SLA, исключает delivered с тем же дедлайном', async () => {
    const tenantId = await seedTenant()
    const chainId = await seedChain(`SLA Chain ${randomUUID().slice(0, 8)}`)
    const pharmacyId = await seedPharmacy(chainId, `SLA Pharmacy ${randomUUID().slice(0, 8)}`)
    const customerId = await seedCustomer(tenantId)
    const pastDeadline = new Date(Date.now() - 60 * 60 * 1000)
    const futureDeadline = new Date(Date.now() + 60 * 60 * 1000)
    const breached = await seedOrder({ tenantId, pharmacyId, customerId, status: 'processing', slaDeadlineAt: pastDeadline })
    const notYetBreached = await seedOrder({ tenantId, pharmacyId, customerId, status: 'processing', slaDeadlineAt: futureDeadline })
    const deliveredPastDeadline = await seedOrder({ tenantId, pharmacyId, customerId, status: 'delivered', slaDeadlineAt: pastDeadline })
    const ownAdminToken = sign({ sub: randomUUID(), role: 'pharmacy_admin', tenantId, pharmacyId: null, chainId })

    const res = await getOrders(ownAdminToken, '&scope=own&filter[slaBreached]=true')

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly OrderSummaryBody[]>
    const ids = body.data.map((o) => o.id)
    expect(ids).toContain(breached.id)
    expect(ids).not.toContain(notYetBreached.id)
    expect(ids).not.toContain(deliveredPastDeadline.id)
  })
})
