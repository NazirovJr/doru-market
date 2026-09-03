/**
 * `RetryPaymentController` — Supertest интеграция (EP-10, DTJ-241, SRS-PAY-041) против РЕАЛЬНЫХ
 * Postgres/Redis (D-EP09-14, тот же `createTestApp()`, что `checkout.controller.integration.
 * spec.ts` — переиспользован, не продублирован: `OrdersModule` теперь импортирует
 * `PaymentsModule`, поэтому `PAYMENT_INVOICE_PORT` резолвится в ТОЙ ЖЕ testing-module, что уже
 * поднимает этот harness).
 *
 * `paymentMethod ∈ {'alif_mobi','dc_next'}` выключены в R1 (`enabledPaymentMethods` дефолт
 * `['cash_courier']`, DTJ-229) — реальный checkout НЕ может довести заказ до `pending_payment`
 * этим методом через HTTP. Заказ в состоянии SRS-PAY-041 («pending_payment без
 * payment_transaction_id — предыдущий createInvoice упал после commit») сеется НАПРЯМУЮ SQL
 * (тот же приём, что остальные интеграционные тесты этого каталога — прямой INSERT/UPDATE
 * фикстур, не через use case, когда нужное состояние недостижимо обычным HTTP-путём в R1).
 *
 * Критерии 3–4 DTJ-241:
 *   3. `pending_payment` БЕЗ `payment_transaction_id` → новый `InvoiceRef`, `qrPayload` доступен.
 *   4. `paid_escrow` → `409 ORDER_NOT_RETRYABLE`.
 */
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.ORDERS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

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
  readonly error: { readonly code: string; readonly message?: string }
}
interface RetryPaymentBody {
  readonly orderId: string
  readonly providerRef: string
  readonly qrPayload: string
  readonly expiresAt: string
}

const TENANT_ID = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5'

/** `OrderNumber` VO формат `DTJ-{YYMMDD}-{seq5}` (`shared-kernel/domain/value-objects/
 *  order-number.vo.ts`) — `order_number` UNIQUE, счётчик даёт уникальность внутри файла. */
let orderNumberSeq = 0
function nextOrderNumber(): string {
  orderNumberSeq += 1
  return `DTJ-260903-${String(orderNumberSeq).padStart(5, '0')}`
}

describe.skipIf(!postgresAvailable)('RetryPaymentController — Supertest integration (DTJ-241)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let pharmacyId: string
  let chainId: string
  const createdUserIds: string[] = []
  const createdOrderIds: string[] = []

  /** `DrizzleOrderRepository.hydrate` бросает «data integrity violation» на `pharmacy_id IS NULL`
   *  (защита от испорченной строки) — заказ обязан ссылаться на реальную аптеку. */
  async function seedPharmacy(): Promise<string> {
    const chain = await pool.query<{ id: string }>(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status)
       VALUES ($1, 'Test Chain DTJ-241', 'Test Chain LLC DTJ-241', $2, 'active') RETURNING id`,
      [randomUUID(), `TIN-DTJ241-${randomUUID().slice(0, 8)}`],
    )
    chainId = chain.rows[0]?.id ?? ''
    const pharmacy = await pool.query<{ id: string }>(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, 'Test Pharmacy DTJ-241', 'Dushanbe, test str. 241', 38.5598, 68.7870, '+992900000241', 'active')
       RETURNING id`,
      [randomUUID(), chainId],
    )
    return pharmacy.rows[0]?.id ?? ''
  }

  async function seedCustomer(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, 'customer', true)`,
      [id, TENANT_ID, `+99293${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`],
    )
    createdUserIds.push(id)
    return id
  }

  function signCustomer(userId: string): string {
    return jwtSigner.sign({ sub: userId, role: 'customer', tenantId: TENANT_ID, pharmacyId: null, chainId: null, sessionId: randomUUID() })
  }

  /** Заказ в состоянии SRS-PAY-041 — см. JSDoc файла: `pending_payment` без `payment_transaction_id`. */
  async function seedPendingPaymentOrder(customerId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, payment_transaction_id,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'alif_mobi', 'pending_payment', NULL, 100.00, 0.00, 100.00, 'x', $5, $6)`,
      [id, nextOrderNumber(), customerId, pharmacyId, TENANT_ID, randomUUID()],
    )
    createdOrderIds.push(id)
    return id
  }

  /** Given заказ уже `paid_escrow` — AC4. */
  async function seedPaidEscrowOrder(customerId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, payment_transaction_id,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'alif_mobi', 'paid_escrow', 'mock_txn_already_paid', 100.00, 0.00, 100.00, 'x', $5, $6)`,
      [id, nextOrderNumber(), customerId, pharmacyId, TENANT_ID, randomUUID()],
    )
    createdOrderIds.push(id)
    return id
  }

  function retryRequest(orderId: string, token: string, idempotencyKey: string): request.Test {
    return request(httpServer)
      .post(`/api/v1/orders/${orderId}/retry-payment`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      'test-orders-241',
    ])
    pharmacyId = await seedPharmacy()
    // fakeMockBankAutoPayQueue — см. JSDoc `test-app.ts` (foundIssue DTJ-238, BullMQ jobId с `:`).
    ctx = await createTestApp({ fakeMockBankAutoPayQueue: true })
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM payment_operations WHERE order_id = ANY($1)', [createdOrderIds])
      await pool.query('DELETE FROM idempotency_keys WHERE user_id = ANY($1)', [createdUserIds])
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId])
      await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId])
      await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  it('AC3 — pending_payment без payment_transaction_id → 200, новый InvoiceRef с qrPayload', async () => {
    const customerId = await seedCustomer()
    const token = signCustomer(customerId)
    const orderId = await seedPendingPaymentOrder(customerId)

    const res = await retryRequest(orderId, token, randomUUID())

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<RetryPaymentBody>
    expect(body.data.orderId).toBe(orderId)
    expect(body.data.providerRef).toMatch(/^mock_inv_/)
    expect(body.data.qrPayload).toBe(`mock://pay/${body.data.providerRef}`)
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now())

    const rows = await pool.query<{ order_id: string; operation_type: string }>(
      'SELECT order_id, operation_type FROM payment_operations WHERE order_id = $1',
      [orderId],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]?.operation_type).toBe('create_bill')
  })

  it('AC4 — заказ уже paid_escrow → 409 ORDER_NOT_RETRYABLE, ни одной строки payment_operations', async () => {
    const customerId = await seedCustomer()
    const token = signCustomer(customerId)
    const orderId = await seedPaidEscrowOrder(customerId)

    const res = await retryRequest(orderId, token, randomUUID())

    expect(res.status).toBe(409)
    expect((res.body as ErrorBody).error.code).toBe('ORDER_NOT_RETRYABLE')
    const rows = await pool.query('SELECT id FROM payment_operations WHERE order_id = $1', [orderId])
    expect(rows.rowCount).toBe(0)
  })

  it('чужой заказ (другой customer, тот же тенант) → 403 FORBIDDEN', async () => {
    const owner = await seedCustomer()
    const orderId = await seedPendingPaymentOrder(owner)
    const stranger = await seedCustomer()
    const strangerToken = signCustomer(stranger)

    const res = await retryRequest(orderId, strangerToken, randomUUID())

    expect(res.status).toBe(403)
  })

  it('несуществующий заказ → 404 NOT_FOUND', async () => {
    const customerId = await seedCustomer()
    const token = signCustomer(customerId)

    const res = await retryRequest(randomUUID(), token, randomUUID())

    expect(res.status).toBe(404)
  })

  it('без заголовка Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const customerId = await seedCustomer()
    const token = signCustomer(customerId)
    const orderId = await seedPendingPaymentOrder(customerId)

    const res = await request(httpServer)
      .post(`/api/v1/orders/${orderId}/retry-payment`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })
})
