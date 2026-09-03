/**
 * Сквозной тест совместимости порта `orders`↔`payments` (EP-09/EP-10, DTJ-241 DoD:
 * «реальный вызов CheckoutUseCase (мок PaymentProvider, реальный PaymentInvoiceAdapter) —
 * подтверждает совместимость сигнатур порта orders и реализации payments»).
 *
 * Реальный `CheckoutUseCase` (не мок) → реальный `PAYMENT_INVOICE_PORT` (`PaymentInvoiceAdapter`,
 * `payments`-модуль, ЗАМЕНИЛ `NullPaymentInvoiceAdapter` этим тикетом) → реальный
 * `CreatePaymentInvoiceUseCase` → `MockBankProvider` (единственный реально включённый
 * `PaymentProvider` в R1 — не мок в смысле «тестовый дублёр», а РЕАЛЬНЫЙ провайдер продукта,
 * Charter DoD п.7) → реальный Postgres.
 *
 * `paymentMethod ∈ {'alif_mobi','dc_next'}` выключен в R1 по умолчанию
 * (`TenancyFacadeAdapter.getEnabledPaymentMethods` — константа `['cash_courier']`) — этот
 * ЕДИНСТВЕННЫЙ файл во всём наборе интеграционных тестов легитимно подменяет
 * `TENANCY_FACADE_PORT` (`createTestApp({ enabledPaymentMethods: [...] })`, см. JSDoc
 * `test-app.ts`) — не для обхода бизнес-правила, а чтобы вообще получить возможность провести
 * non-cash заказ через `CheckoutUseCase` РЕАЛЬНЫМ HTTP-путём и доказать совместимость портов
 * (сценарий, который физически станет достижим для реальных пользователей в R3).
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
interface OrderResultBody {
  readonly orderId: string
  readonly status: string
  readonly paymentPending: boolean
}
interface CheckoutDataBody {
  readonly orders: readonly OrderResultBody[]
}

const TENANT_ID = 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6'

describe.skipIf(!postgresAvailable)('CheckoutUseCase ↔ PaymentInvoicePort — сквозная совместимость (DTJ-241 DoD)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let pharmacyId: string
  let chainId: string
  let medicineId: string
  const createdUserIds: string[] = []
  const createdOrderIds: string[] = []

  async function seedPharmacy(): Promise<string> {
    const chain = await pool.query<{ id: string }>(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status)
       VALUES ($1, 'Test Chain Compat', 'Test Chain LLC Compat', $2, 'active') RETURNING id`,
      [randomUUID(), `TIN-COMPAT-${randomUUID().slice(0, 8)}`],
    )
    chainId = chain.rows[0]?.id ?? ''
    const pharmacy = await pool.query<{ id: string }>(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, 'Test Pharmacy Compat', 'Dushanbe, test str.', 38.5598, 68.7870, '+992900000242', 'active')
       RETURNING id`,
      [randomUUID(), chainId],
    )
    return pharmacy.rows[0]?.id ?? ''
  }

  async function seedRootCategoryId(): Promise<number> {
    const category = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('root-dtj241', 'Корень', 'Root', 'Root', 'otc', 0, true)
       ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug RETURNING id`,
    )
    const id = category.rows[0]?.id
    if (id === undefined) throw new Error('seedRootCategoryId: no id returned')
    return id
  }

  async function seedMedicine(): Promise<string> {
    const id = randomUUID()
    const categoryId = await seedRootCategoryId()
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, true)`,
      [id, `Trade-DTJ241-${id}`, `INN-DTJ241-${id}`, categoryId],
    )
    return id
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

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      'test-orders-241-compat',
    ])
    pharmacyId = await seedPharmacy()
    medicineId = await seedMedicine()
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $2, $3, $4, CURRENT_DATE + INTERVAL '1 year')`,
      [pharmacyId, medicineId, 2_000, 10],
    )
    // enabledPaymentMethods override — см. JSDoc файла/test-app.ts.
    ctx = await createTestApp({ fakeMockBankAutoPayQueue: true, enabledPaymentMethods: ['alif_mobi'] })
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM payment_operations WHERE order_id = ANY($1)', [createdOrderIds])
      await pool.query('DELETE FROM order_items WHERE order_id = ANY($1)', [createdOrderIds])
      await pool.query('DELETE FROM idempotency_keys WHERE user_id = ANY($1)', [createdUserIds])
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds])
      await pool.query('DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM cart WHERE tenant_id = $1)', [TENANT_ID])
      await pool.query('DELETE FROM cart WHERE tenant_id = $1', [TENANT_ID])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM pharmacy_inventory WHERE pharmacy_id = $1', [pharmacyId])
      await pool.query('DELETE FROM medicines WHERE id = $1', [medicineId])
      await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId])
      await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId])
      await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  it('non-cash checkout (alif_mobi) через РЕАЛЬНЫЙ CheckoutUseCase доходит до PaymentInvoicePort и создаёт InvoiceRef', async () => {
    const customerId = await seedCustomer()
    const token = signCustomer(customerId)
    const cartId = randomUUID()
    await pool.query(`INSERT INTO cart (id, tenant_id, customer_id) VALUES ($1, $2, $3)`, [cartId, TENANT_ID, customerId])
    const itemId = randomUUID()
    await pool.query(`INSERT INTO cart_items (id, cart_id, medicine_id, pharmacy_id, quantity) VALUES ($1, $2, $3, $4, $5)`, [
      itemId,
      cartId,
      medicineId,
      pharmacyId,
      1,
    ])

    const res = await request(httpServer)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        cartItemIds: [itemId],
        inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
        paymentMethod: 'alif_mobi',
      })

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<CheckoutDataBody>
    expect(body.data.orders).toHaveLength(1)
    const order = body.data.orders[0]
    expect(order?.status).toBe('pending_payment')
    // paymentPending=false — PaymentInvoicePort.createInvoice() СИНХРОННО succeeded (D-EP09-17):
    // сигнатуры совпали 1:1, PaymentInvoiceAdapter корректно замкнул orders-контракт.
    expect(order?.paymentPending).toBe(false)
    if (order !== undefined) createdOrderIds.push(order.orderId)

    const rows = await pool.query<{ operation_type: string; provider: string }>(
      'SELECT operation_type, provider FROM payment_operations WHERE order_id = $1',
      [order?.orderId],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]?.operation_type).toBe('create_bill')
    expect(rows.rows[0]?.provider).toBe('mock_bank')
  })
})
