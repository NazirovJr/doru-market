/**
 * `CheckoutController` — Supertest интеграция (EP-09, DTJ-233) против РЕАЛЬНЫХ Postgres/Redis
 * (D-EP09-14: живые сервисы + `describe.skipIf`, не Testcontainers). Один кейс на каждый АС
 * тикета + доп. проверки идемпотентности/кросс-тенантности, которые «Сдача» требует явно:
 *
 *   - `POST   /api/v1/orders` (без `Idempotency-Key`, частичный успех, дрейф цены на ВСЕ группы,
 *     повтор с тем же/другим телом, конкурентный дубль через `Promise.all`)
 *   - `POST   /api/v1/orders/:id/cancel` (чужой заказ того же тенанта → 403, ЧУЖОЙ ТЕНАНТ → 404)
 *   - `GET    /api/v1/orders/:id/payment-status` (заглушка → 501 NOT_IMPLEMENTED)
 *
 * Все заказы — `paymentMethod: 'cash_courier'` (единственный включённый в R1 метод,
 * `TenancyFacadeAdapter.getEnabledPaymentMethods`, см. JSDoc `checkout-race-conditions.
 * integration.spec.ts`) — синхронно `confirmed` (D-25), без обращения к `PaymentInvoicePort`.
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
  process.env.ORDERS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

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
interface OrderResultBody {
  readonly orderId: string
  readonly orderNumber: string
  readonly pharmacyId: string
  readonly status: string
  readonly totalAmountDiram: number
  readonly paymentPending: boolean
}
interface CheckoutDataBody {
  readonly orders: readonly OrderResultBody[]
  readonly failedGroups: readonly { readonly pharmacyId: string; readonly reason: string; readonly details?: Record<string, unknown> }[]
}

/** Два ОТДЕЛЬНЫХ тенанта (не пересекаются с `GUEST_TENANT_ID`/DTJ-231's own — параллельные файлы
 *  этого пакета бьют в ТУ ЖЕ `dorutj_test`). */
const TENANT_A_ID = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3'
const TENANT_B_ID = 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4'

describe.skipIf(!postgresAvailable)('CheckoutController — Supertest integration (DTJ-233)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let chainId: string | undefined
  let pharmacyA: string
  let pharmacyB: string
  const createdUserIds: string[] = []
  const createdMedicineIds: string[] = []
  const cartIdByCustomer = new Map<string, string>()

  async function resolveRootCategoryId(): Promise<number> {
    const category = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('root-dtj233', 'Корень', 'Root', 'Root', 'otc', 0, true)
       ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
       RETURNING id`,
    )
    const id = category.rows[0]?.id
    if (id === undefined) throw new Error('resolveRootCategoryId: no id returned')
    return id
  }

  async function seedMedicine(): Promise<string> {
    const id = randomUUID()
    const categoryId = await resolveRootCategoryId()
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, true)`,
      [id, `Trade-DTJ233-${id}`, `INN-DTJ233-${id}`, categoryId],
    )
    createdMedicineIds.push(id)
    return id
  }

  async function seedActivePharmacy(name: string): Promise<string> {
    if (chainId === undefined) {
      const chain = await pool.query<{ id: string }>(
        `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status)
         VALUES ($1, 'Test Chain DTJ-233', 'Test Chain LLC DTJ-233', $2, 'active')
         RETURNING id`,
        [randomUUID(), `TIN-DTJ233-${randomUUID().slice(0, 8)}`],
      )
      chainId = chain.rows[0]?.id ?? ''
    }
    const pharmacy = await pool.query<{ id: string }>(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, $3, 'Dushanbe, test str. 233', 38.5598, 68.7870, '+992900000233', 'active')
       RETURNING id`,
      [randomUUID(), chainId, name],
    )
    return pharmacy.rows[0]?.id ?? ''
  }

  async function seedInventory(input: { pharmacyId: string; medicineId: string; quantity: number; priceDiram: number }): Promise<void> {
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $2, $3, $4, CURRENT_DATE + INTERVAL '1 year')`,
      [input.pharmacyId, input.medicineId, input.priceDiram, input.quantity],
    )
  }

  async function seedCustomer(tenantId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, 'customer', true)`,
      [id, tenantId, `+99293${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`],
    )
    createdUserIds.push(id)
    return id
  }

  function signCustomer(userId: string, tenantId: string): string {
    return jwtSigner.sign({ sub: userId, role: 'customer', tenantId, pharmacyId: null, chainId: null, sessionId: randomUUID() })
  }

  /** `UNIQUE(tenant_id, customer_id)` на `cart` — одна корзина на клиента, кэшируем id. */
  async function ensureCartForCustomer(customerId: string, tenantId: string): Promise<string> {
    const cached = cartIdByCustomer.get(customerId)
    if (cached !== undefined) return cached
    const cartId = randomUUID()
    await pool.query(`INSERT INTO cart (id, tenant_id, customer_id) VALUES ($1, $2, $3)`, [cartId, tenantId, customerId])
    cartIdByCustomer.set(customerId, cartId)
    return cartId
  }

  async function seedCartItem(input: {
    customerId: string
    tenantId: string
    pharmacyId: string
    medicineId: string
    quantity: number
  }): Promise<string> {
    const cartId = await ensureCartForCustomer(input.customerId, input.tenantId)
    const itemId = randomUUID()
    await pool.query(
      `INSERT INTO cart_items (id, cart_id, medicine_id, pharmacy_id, quantity) VALUES ($1, $2, $3, $4, $5)`,
      [itemId, cartId, input.medicineId, input.pharmacyId, input.quantity],
    )
    return itemId
  }

  function checkoutRequest(token: string, idempotencyKey?: string): request.Test {
    const req = request(httpServer).post('/api/v1/orders').set('Authorization', `Bearer ${token}`)
    return idempotencyKey === undefined ? req : req.set('Idempotency-Key', idempotencyKey)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [TENANT_A_ID, 'test-orders-233-a'])
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [TENANT_B_ID, 'test-orders-233-b'])
    pharmacyA = await seedActivePharmacy('Test Pharmacy DTJ-233-A')
    pharmacyB = await seedActivePharmacy('Test Pharmacy DTJ-233-B')

    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      const tenantIds = [TENANT_A_ID, TENANT_B_ID]
      await pool.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = ANY($1))', [tenantIds])
      await pool.query('DELETE FROM orders WHERE tenant_id = ANY($1)', [tenantIds])
      await pool.query('DELETE FROM idempotency_keys WHERE user_id = ANY($1)', [createdUserIds])
      await pool.query('DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM cart WHERE tenant_id = ANY($1))', [tenantIds])
      await pool.query('DELETE FROM cart WHERE tenant_id = ANY($1)', [tenantIds])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM pharmacy_inventory WHERE pharmacy_id = ANY($1)', [[pharmacyA, pharmacyB]])
      await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [[pharmacyA, pharmacyB]])
      await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId])
      if (createdMedicineIds.length > 0) {
        await pool.query('DELETE FROM medicines WHERE id = ANY($1)', [createdMedicineIds])
      }
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[TENANT_A_ID, TENANT_B_ID]])
      await pool.end().catch(() => undefined)
    }
  })

  it('AC1 — POST /api/v1/orders без заголовка Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED, CheckoutUseCase не вызван', async () => {
    const customerId = await seedCustomer(TENANT_A_ID)
    const token = signCustomer(customerId, TENANT_A_ID)

    const res = await checkoutRequest(token).send({
      cartItemIds: [randomUUID()],
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
      paymentMethod: 'cash_courier',
    })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    const orderRows = await pool.query('SELECT id FROM orders WHERE customer_id = $1', [customerId])
    expect(orderRows.rowCount).toBe(0)
  })

  it('успешный cash_courier checkout — 200, заказ синхронно confirmed (D-25), без paymentPending', async () => {
    const priceDiram = 1_500
    const med = await seedMedicine()
    await seedInventory({ pharmacyId: pharmacyA, medicineId: med, quantity: 10, priceDiram })
    const customerId = await seedCustomer(TENANT_A_ID)
    const token = signCustomer(customerId, TENANT_A_ID)
    const itemId = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: med, quantity: 2 })

    const res = await checkoutRequest(token, randomUUID()).send({
      cartItemIds: [itemId],
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
      paymentMethod: 'cash_courier',
    })

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<CheckoutDataBody>
    expect(body.data.orders).toHaveLength(1)
    expect(body.data.orders[0]).toMatchObject({ pharmacyId: pharmacyA, status: 'confirmed', totalAmountDiram: 3_000, paymentPending: false })
    expect(body.data.failedGroups).toEqual([])
    expect(body.meta).toEqual({ excludedItems: [] })
  })

  it('AC2 (composite) — частичный успех: 2 аптеки, одна в наличии, другая с quantity=0 → HTTP 200, data.orders И data.failedGroups непустые ОДНОВРЕМЕННО', async () => {
    const priceDiram = 1_400
    const medOk = await seedMedicine()
    const medOut = await seedMedicine()
    await seedInventory({ pharmacyId: pharmacyA, medicineId: medOk, quantity: 10, priceDiram })
    await seedInventory({ pharmacyId: pharmacyB, medicineId: medOut, quantity: 0, priceDiram })
    const customerId = await seedCustomer(TENANT_A_ID)
    const token = signCustomer(customerId, TENANT_A_ID)
    const itemOk = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: medOk, quantity: 1 })
    const itemOut = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyB, medicineId: medOut, quantity: 1 })

    const res = await checkoutRequest(token, randomUUID()).send({
      cartItemIds: [itemOk, itemOut],
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
      paymentMethod: 'cash_courier',
    })

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<CheckoutDataBody>
    expect(body.data.orders).toHaveLength(1)
    expect(body.data.orders[0]?.pharmacyId).toBe(pharmacyA)
    expect(body.data.failedGroups).toHaveLength(1)
    expect(body.data.failedGroups[0]).toMatchObject({ pharmacyId: pharmacyB, reason: 'INSUFFICIENT_STOCK' })
  })

  it('AC4 — PriceOrStockChangedError для ВСЕХ групп запроса → HTTP-статус ответа ВСЁ РАВНО 200 (не 409), ошибка живёт в failedGroups', async () => {
    const priceDiram = 1_600
    const med = await seedMedicine()
    await seedInventory({ pharmacyId: pharmacyA, medicineId: med, quantity: 10, priceDiram })
    const customerId = await seedCustomer(TENANT_A_ID)
    const token = signCustomer(customerId, TENANT_A_ID)
    const itemId = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: med, quantity: 1 }) // actual = 1_600

    const res = await checkoutRequest(token, randomUUID()).send({
      cartItemIds: [itemId],
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
      paymentMethod: 'cash_courier',
      expectedTotalDiramByPharmacy: { [pharmacyA]: 1_000 }, // клиент видел устаревшую цену ЭТОЙ аптеки
    })

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<CheckoutDataBody>
    expect(body.data.orders).toEqual([])
    expect(body.data.failedGroups).toHaveLength(1)
    expect(body.data.failedGroups[0]).toMatchObject({
      pharmacyId: pharmacyA,
      reason: 'PRICE_OR_STOCK_CHANGED',
      details: { actualTotalDiram: 1_600 },
    })
  })

  /**
   * ДОКАЗАТЕЛЬСТВО (задание волны 6, поправка CTO под SRS-ORD-023) — ровно тот сценарий, который
   * был сломан ДО этой правки: до неё `expectedTotalDiram` было ОДНИМ числом на весь запрос, но
   * `DetectPriceDriftService.check()` вызывался ОТДЕЛЬНО для каждой группы — при корзине из двух
   * и более аптек любое переданное значение совпадало максимум с ОДНОЙ группой, и ВТОРАЯ ВСЕГДА
   * получала ложный `PRICE_OR_STOCK_CHANGED`, даже когда клиент видел актуальную цену. Тест ниже
   * до этой правки было невозможно написать честно (он либо потребовал бы ОДНО общее число, либо
   * не проверял бы вторую аптеку вовсе) — после правки он обязан проходить.
   */
  it('ДОКАЗАТЕЛЬСТВО — корзина из ДВУХ аптек, для ОБЕИХ передана ВЕРНАЯ ожидаемая сумма (expectedTotalDiramByPharmacy, ключ pharmacyId) → ОБА заказа оформлены, ни одного ложного PRICE_OR_STOCK_CHANGED', async () => {
    const priceA = 1_700
    const priceB = 2_300
    const medA = await seedMedicine()
    const medB = await seedMedicine()
    await seedInventory({ pharmacyId: pharmacyA, medicineId: medA, quantity: 10, priceDiram: priceA })
    await seedInventory({ pharmacyId: pharmacyB, medicineId: medB, quantity: 10, priceDiram: priceB })
    const customerId = await seedCustomer(TENANT_A_ID)
    const token = signCustomer(customerId, TENANT_A_ID)
    const itemA = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: medA, quantity: 2 }) // 1_700 × 2 = 3_400
    const itemB = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyB, medicineId: medB, quantity: 3 }) // 2_300 × 3 = 6_900

    const res = await checkoutRequest(token, randomUUID()).send({
      cartItemIds: [itemA, itemB],
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
      paymentMethod: 'cash_courier',
      expectedTotalDiramByPharmacy: { [pharmacyA]: 3_400, [pharmacyB]: 6_900 },
    })

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<CheckoutDataBody>
    expect(body.data.failedGroups).toEqual([])
    expect(body.data.orders).toHaveLength(2)
    const pharmacyIds = body.data.orders.map((o) => o.pharmacyId).sort()
    expect(pharmacyIds).toEqual([pharmacyA, pharmacyB].sort())
  })

  it('НЕГАТИВНЫЙ — корзина из ДВУХ аптек, у ОДНОЙ (Б) переданная сумма разошлась с фактом → Б в failedGroups с PRICE_OR_STOCK_CHANGED и details.actualTotalDiram, А (сумма верна) оформлена (частичный успех сохранён)', async () => {
    const priceA = 1_800
    const priceB = 2_500
    const medA = await seedMedicine()
    const medB = await seedMedicine()
    await seedInventory({ pharmacyId: pharmacyA, medicineId: medA, quantity: 10, priceDiram: priceA })
    await seedInventory({ pharmacyId: pharmacyB, medicineId: medB, quantity: 10, priceDiram: priceB })
    const customerId = await seedCustomer(TENANT_A_ID)
    const token = signCustomer(customerId, TENANT_A_ID)
    const itemA = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: medA, quantity: 1 }) // 1_800, ожидание верно
    const itemB = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyB, medicineId: medB, quantity: 1 }) // факт 2_500, клиент ждёт 2_000

    const res = await checkoutRequest(token, randomUUID()).send({
      cartItemIds: [itemA, itemB],
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
      paymentMethod: 'cash_courier',
      expectedTotalDiramByPharmacy: { [pharmacyA]: 1_800, [pharmacyB]: 2_000 },
    })

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<CheckoutDataBody>
    expect(body.data.orders).toHaveLength(1)
    expect(body.data.orders[0]?.pharmacyId).toBe(pharmacyA)
    expect(body.data.failedGroups).toHaveLength(1)
    expect(body.data.failedGroups[0]).toMatchObject({
      pharmacyId: pharmacyB,
      reason: 'PRICE_OR_STOCK_CHANGED',
      details: { actualTotalDiram: 2_500, expectedTotalDiram: 2_000 },
    })
  })

  it('повтор с ТЕМ ЖЕ Idempotency-Key и ТЕМ ЖЕ телом → возвращён СОХРАНЁННЫЙ 200 с тем же orderId, новый заказ не создан', async () => {
    const priceDiram = 1_100
    const med = await seedMedicine()
    await seedInventory({ pharmacyId: pharmacyA, medicineId: med, quantity: 10, priceDiram })
    const customerId = await seedCustomer(TENANT_A_ID)
    const token = signCustomer(customerId, TENANT_A_ID)
    const itemId = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: med, quantity: 1 })
    const idempotencyKey = randomUUID()
    const requestBody = {
      cartItemIds: [itemId],
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
      paymentMethod: 'cash_courier',
    }

    const first = await checkoutRequest(token, idempotencyKey).send(requestBody)
    const second = await checkoutRequest(token, idempotencyKey).send(requestBody)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstOrderId = (first.body as SuccessBody<CheckoutDataBody>).data.orders[0]?.orderId
    const secondOrderId = (second.body as SuccessBody<CheckoutDataBody>).data.orders[0]?.orderId
    expect(secondOrderId).toBe(firstOrderId)
    const orderRows = await pool.query('SELECT id FROM orders WHERE customer_id = $1', [customerId])
    expect(orderRows.rowCount).toBe(1)
  })

  it('повтор с ТЕМ ЖЕ Idempotency-Key, но ДРУГИМ телом → 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
    const priceDiram = 1_050
    const medFirst = await seedMedicine()
    const medSecond = await seedMedicine()
    await seedInventory({ pharmacyId: pharmacyA, medicineId: medFirst, quantity: 10, priceDiram })
    await seedInventory({ pharmacyId: pharmacyA, medicineId: medSecond, quantity: 10, priceDiram })
    const customerId = await seedCustomer(TENANT_A_ID)
    const token = signCustomer(customerId, TENANT_A_ID)
    const itemFirst = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: medFirst, quantity: 1 })
    const itemSecond = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: medSecond, quantity: 1 })
    const idempotencyKey = randomUUID()
    const address = { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 }

    const first = await checkoutRequest(token, idempotencyKey).send({ cartItemIds: [itemFirst], inlineAddress: address, paymentMethod: 'cash_courier' })
    const second = await checkoutRequest(token, idempotencyKey).send({ cartItemIds: [itemSecond], inlineAddress: address, paymentMethod: 'cash_courier' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect((second.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
  })

  it('конкурентный дубль на живом HTTP (Promise.all, ОДИН Idempotency-Key) → ровно один 200, второй немедленно 409, ровно один заказ создан', async () => {
    const priceDiram = 1_300
    const med = await seedMedicine()
    await seedInventory({ pharmacyId: pharmacyA, medicineId: med, quantity: 10, priceDiram })
    const customerId = await seedCustomer(TENANT_A_ID)
    const token = signCustomer(customerId, TENANT_A_ID)
    const itemId = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: med, quantity: 1 })
    const idempotencyKey = randomUUID()
    const requestBody = {
      cartItemIds: [itemId],
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
      paymentMethod: 'cash_courier',
    }

    const [first, second] = await Promise.all([
      checkoutRequest(token, idempotencyKey).send(requestBody),
      checkoutRequest(token, idempotencyKey).send(requestBody),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 409])
    const conflictRes = first.status === 409 ? first : second
    expect((conflictRes.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
    const orderRows = await pool.query('SELECT id FROM orders WHERE customer_id = $1', [customerId])
    expect(orderRows.rowCount).toBe(1)
  })

  it('AC3 — POST /orders/:id/cancel от customer, НЕ владеющего заказом (тот же тенант) → 403 FORBIDDEN', async () => {
    const priceDiram = 1_200
    const med = await seedMedicine()
    await seedInventory({ pharmacyId: pharmacyA, medicineId: med, quantity: 10, priceDiram })
    const ownerCustomerId = await seedCustomer(TENANT_A_ID)
    const ownerToken = signCustomer(ownerCustomerId, TENANT_A_ID)
    const itemId = await seedCartItem({ customerId: ownerCustomerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: med, quantity: 1 })
    const checkoutRes = await checkoutRequest(ownerToken, randomUUID()).send({
      cartItemIds: [itemId],
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
      paymentMethod: 'cash_courier',
    })
    const orderId = (checkoutRes.body as SuccessBody<CheckoutDataBody>).data.orders[0]?.orderId ?? ''

    const strangerCustomerId = await seedCustomer(TENANT_A_ID)
    const strangerToken = signCustomer(strangerCustomerId, TENANT_A_ID)
    const res = await request(httpServer)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ reason: 'customer_changed_mind' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('Cross-tenant — POST /orders/:id/cancel на заказ ЧУЖОГО тенанта → 404 NOT_FOUND (SRS-API-046, НЕ 403 — существование заказа не подтверждается)', async () => {
    const priceDiram = 1_250
    const med = await seedMedicine()
    await seedInventory({ pharmacyId: pharmacyA, medicineId: med, quantity: 10, priceDiram })
    const ownerCustomerId = await seedCustomer(TENANT_A_ID)
    const ownerToken = signCustomer(ownerCustomerId, TENANT_A_ID)
    const itemId = await seedCartItem({ customerId: ownerCustomerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: med, quantity: 1 })
    const checkoutRes = await checkoutRequest(ownerToken, randomUUID()).send({
      cartItemIds: [itemId],
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
      paymentMethod: 'cash_courier',
    })
    const orderId = (checkoutRes.body as SuccessBody<CheckoutDataBody>).data.orders[0]?.orderId ?? ''

    const otherTenantCustomerId = await seedCustomer(TENANT_B_ID)
    const otherTenantToken = signCustomer(otherTenantCustomerId, TENANT_B_ID)
    const res = await request(httpServer)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${otherTenantToken}`)
      .send({ reason: 'customer_changed_mind' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('успешная отмена собственного заказа владельцем → 200, status=cancelled, refundIssued=false (cash_courier, D-25)', async () => {
    const priceDiram = 1_350
    const med = await seedMedicine()
    await seedInventory({ pharmacyId: pharmacyA, medicineId: med, quantity: 10, priceDiram })
    const customerId = await seedCustomer(TENANT_A_ID)
    const token = signCustomer(customerId, TENANT_A_ID)
    const itemId = await seedCartItem({ customerId, tenantId: TENANT_A_ID, pharmacyId: pharmacyA, medicineId: med, quantity: 1 })
    const checkoutRes = await checkoutRequest(token, randomUUID()).send({
      cartItemIds: [itemId],
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', latitude: 38.5598, longitude: 68.787 },
      paymentMethod: 'cash_courier',
    })
    const orderId = (checkoutRes.body as SuccessBody<CheckoutDataBody>).data.orders[0]?.orderId ?? ''

    const res = await request(httpServer)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'customer_changed_mind' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { orderId, status: 'cancelled', refundIssued: false } })
  })

  it('GET /orders/:id/payment-status → 501 NOT_IMPLEMENTED (заглушка до EP-10)', async () => {
    const customerId = await seedCustomer(TENANT_A_ID)
    const token = signCustomer(customerId, TENANT_A_ID)

    const res = await request(httpServer)
      .get(`/api/v1/orders/${randomUUID()}/payment-status`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(501)
    expect((res.body as ErrorBody).error.code).toBe('NOT_IMPLEMENTED')
  })
})
