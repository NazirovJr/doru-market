// DTJ-309 — Idempotency-Key на 7 маршрутах терминала. Harness общий, см. rbac-isolation.spec.ts.
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from '../orders/__tests__/test-app.js'

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

interface ErrorBody {
  readonly error: { readonly code: string }
}

const TENANT_ID = '109de109-de10-4109-8109-de109de109de'
const TARGET_BARCODE = '4006381333931' // валидный EAN-13, 1:1 с pharmacy-terminal-items.controller.integration.spec.ts

let orderNumberSeq = 0
function nextOrderNumber(): string {
  orderNumberSeq += 1
  return `DTJ-260926-${String(orderNumberSeq).padStart(5, '0')}`
}
let batchNumberSeq = 0
function nextBatchNumber(): string {
  batchNumberSeq += 1
  return `BATCH-DTJ309I-${String(batchNumberSeq).padStart(4, '0')}`
}

describe.skipIf(!postgresAvailable)('Pharmacy terminal Idempotency-Key — Supertest integration (DTJ-309)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let pharmacyId: string
  let categoryId: number
  let medicineId: string
  let customerId: string
  let pharmacistId: string
  let pharmacistToken: string
  const createdUserIds: string[] = []
  const createdOrderIds: string[] = []
  const createdBatchIds: string[] = []
  const createdOtpIds: string[] = []

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone) VALUES ($1, 'DTJ-309I pharmacy', 'Dushanbe, test str. 309', 38.5598, 68.7870, '+992900000310')`,
      [id],
    )
    return id
  }

  async function seedUser(role: 'customer' | 'pharmacist'): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, $3)`, [id, TENANT_ID, role])
    createdUserIds.push(id)
    return id
  }

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  interface SeedOrderOptions {
    readonly status: string
    readonly assignedPharmacistId?: string | null
    readonly handoverOtpId?: string | null
  }

  async function seedOrder(options: SeedOrderOptions): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, payment_transaction_id,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id,
          checkout_attempt_id, assigned_pharmacist_id, handover_otp_id)
       VALUES ($1, $2, $3, $4, 'alif_mobi', $5, 'mock_txn_309i', 20.00, 5.00, 25.00, 'x', $6, $7, $8, $9)`,
      [
        id,
        nextOrderNumber(),
        customerId,
        pharmacyId,
        options.status,
        TENANT_ID,
        randomUUID(),
        options.assignedPharmacistId ?? null,
        options.handoverOtpId ?? null,
      ],
    )
    createdOrderIds.push(id)
    return id
  }

  interface SeedItemOptions {
    readonly orderId: string
    readonly fulfillmentStatus: 'pending' | 'scanned_ok' | 'unavailable'
    readonly inventoryBatchId?: string | null
  }

  async function seedItem(options: SeedItemOptions): Promise<string> { // invariants — см. rbac-isolation.spec.ts
    const inventoryBatchId = options.inventoryBatchId ?? (await seedBatch(10))
    const itemIssueReason = options.fulfillmentStatus === 'unavailable' ? 'out_of_stock' : null
    const row = await pool.query<{ id: string }>(
      `INSERT INTO order_items
         (id, order_id, medicine_id, unit_price_tjs, quantity, total_price_tjs,
          commission_bps, platform_fee_diram, inventory_batch_id, fulfillment_status, item_issue_reason)
       VALUES (gen_random_uuid(), $1, $2, 10.00, 1, 10.00, 800, 160, $3, $4, $5)
       RETURNING id`,
      [options.orderId, medicineId, inventoryBatchId, options.fulfillmentStatus, itemIssueReason],
    )
    const itemId = row.rows[0]?.id
    if (itemId === undefined) throw new Error('seedItem: no id returned')
    return itemId
  }

  async function seedBatch(quantity: number): Promise<string> {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
       VALUES (gen_random_uuid(), $1, $2, 1000, $3, CURRENT_DATE + INTERVAL '1 year', $4)
       RETURNING id`,
      [pharmacyId, medicineId, quantity, nextBatchNumber()],
    )
    const id = row.rows[0]?.id
    if (id === undefined) throw new Error('seedBatch: no id returned')
    createdBatchIds.push(id)
    return id
  }

  async function seedHandoverOtp(orderIdForSubject: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO otp_codes (id, tenant_id, subject_ref, purpose, code_hash, plain_code, issued_at, expires_at)
       VALUES ($1, $2, $3, 'delivery_handover', $4, '1234', NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '15 minutes')`,
      [id, TENANT_ID, orderIdForSubject, 'b'.repeat(64)],
    )
    createdOtpIds.push(id)
    return id
  }

  async function seedPickedUpOrder(): Promise<string> {
    const orderId = randomUUID()
    const otpId = await seedHandoverOtp(orderId)
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, payment_transaction_id,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id,
          checkout_attempt_id, handover_otp_id)
       VALUES ($1, $2, $3, $4, 'alif_mobi', 'picked_up', 'mock_txn_309i', 20.00, 5.00, 25.00, 'x', $5, $6, $7)`,
      [orderId, nextOrderNumber(), customerId, pharmacyId, TENANT_ID, randomUUID(), otpId],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  function post(path: string): request.Test {
    return request(httpServer).post(path).set('Authorization', `Bearer ${pharmacistToken}`)
  }

  async function countOtpRows(orderId: string): Promise<number> {
    const row = await pool.query<{ count: string }>('SELECT count(*) FROM otp_codes WHERE subject_ref = $1', [orderId])
    return Number(row.rows[0]?.count ?? '0')
  }

  async function countPartialRequests(orderId: string): Promise<number> {
    const row = await pool.query<{ count: string }>(
      'SELECT count(*) FROM order_partial_fulfillment_requests WHERE order_id = $1',
      [orderId],
    )
    return Number(row.rows[0]?.count ?? '0')
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      'test-dtj-309i',
    ])
    pharmacyId = await seedPharmacy()
    const category = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('dtj-309i-root', 'Корень', 'Root', 'Root', 'otc', 0, true)
       ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug RETURNING id`,
    )
    categoryId = category.rows[0]?.id ?? 0
    const medicine = await pool.query<{ id: string }>(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode, barcode)
       VALUES (gen_random_uuid(), 'DTJ-309I medicine', 'DTJ-309I INN', $1, 'таблетки', 'tablet', '500 мг',
               'Tajikistan', 'Test Pharma', false, 'none', true, false, true, $2)
       RETURNING id`,
      [categoryId, TARGET_BARCODE],
    )
    medicineId = medicine.rows[0]?.id ?? ''
    customerId = await seedUser('customer')
    pharmacistId = await seedUser('pharmacist')

    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    pharmacistToken = sign({ sub: pharmacistId, role: 'pharmacist', tenantId: TENANT_ID, pharmacyId, chainId: null })
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM idempotency_keys WHERE user_id = ANY($1)', [createdUserIds])
      await pool.query('DELETE FROM order_partial_fulfillment_requests WHERE order_id = ANY($1)', [createdOrderIds])
      await pool.query('DELETE FROM order_items WHERE order_id = ANY($1)', [createdOrderIds])
      await pool.query('UPDATE orders SET handover_otp_id = NULL WHERE id = ANY($1)', [createdOrderIds])
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds])
      await pool.query('DELETE FROM otp_codes WHERE id = ANY($1)', [createdOtpIds])
      await pool.query('DELETE FROM pharmacy_inventory WHERE id = ANY($1)', [createdBatchIds])
      await pool.query('DELETE FROM medicines WHERE id = $1', [medicineId])
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [[...createdUserIds, customerId]])
      await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId])
      await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  describe('accept', () => {
    it('без Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const orderId = await seedOrder({ status: 'paid_escrow' })
      const res = await post(`/api/v1/orders/${orderId}/accept`)
      expect(res.status).toBe(400)
      expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    })

    it('повтор того же ключа → кэшированный ответ, заказ принят один раз', async () => {
      const orderId = await seedOrder({ status: 'paid_escrow' })
      const key = randomUUID()
      const first = await post(`/api/v1/orders/${orderId}/accept`).set('Idempotency-Key', key)
      const second = await post(`/api/v1/orders/${orderId}/accept`).set('Idempotency-Key', key)
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(second.body).toEqual(first.body)
      const row = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId])
      expect(row.rows[0]?.status).toBe('processing')
    })

    it('тот же ключ, другое тело → 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
      const orderId = await seedOrder({ status: 'paid_escrow' })
      const key = randomUUID()
      await post(`/api/v1/orders/${orderId}/accept`).set('Idempotency-Key', key).send({})
      const second = await post(`/api/v1/orders/${orderId}/accept`).set('Idempotency-Key', key).send({ note: 'different' })
      expect(second.status).toBe(409)
      expect((second.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
    })
  })

  describe('reclaim', () => {
    async function seedProcessingOrder(): Promise<string> {
      const holder = await seedUser('pharmacist')
      return seedOrder({ status: 'processing', assignedPharmacistId: holder })
    }

    it('без Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const orderId = await seedProcessingOrder()
      const res = await post(`/api/v1/orders/${orderId}/reclaim`).send({ reason: 'shift_change' })
      expect(res.status).toBe(400)
      expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    })

    it('повтор того же ключа+тела → кэшированный ответ, assignedPharmacistId не меняется повторно', async () => {
      const orderId = await seedProcessingOrder()
      const key = randomUUID()
      const body = { reason: 'shift_change' }
      const first = await post(`/api/v1/orders/${orderId}/reclaim`).set('Idempotency-Key', key).send(body)
      const second = await post(`/api/v1/orders/${orderId}/reclaim`).set('Idempotency-Key', key).send(body)
      expect(first.status).toBe(200)
      expect(second.body).toEqual(first.body)
    })

    it('тот же ключ, другая reason → 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
      const orderId = await seedProcessingOrder()
      const key = randomUUID()
      await post(`/api/v1/orders/${orderId}/reclaim`).set('Idempotency-Key', key).send({ reason: 'shift_change' })
      const second = await post(`/api/v1/orders/${orderId}/reclaim`).set('Idempotency-Key', key).send({ reason: 'other' })
      expect(second.status).toBe(409)
      expect((second.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
    })
  })

  describe('scan', () => {
    async function seedPendingItemWithBatch(): Promise<{ orderId: string; itemId: string; batchId: string }> {
      const orderId = await seedOrder({ status: 'processing' })
      const batchId = await seedBatch(10)
      const itemId = await seedItem({ orderId, fulfillmentStatus: 'pending', inventoryBatchId: batchId })
      return { orderId, itemId, batchId }
    }

    async function readBatchQuantity(batchId: string): Promise<number> {
      const row = await pool.query<{ quantity: number }>('SELECT quantity FROM pharmacy_inventory WHERE id = $1', [batchId])
      return row.rows[0]?.quantity ?? -1
    }

    it('без Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const { orderId, itemId } = await seedPendingItemWithBatch()
      const res = await post(`/api/v1/orders/${orderId}/items/${itemId}/scan`).send({ rawBarcode: TARGET_BARCODE, manualEntry: true })
      expect(res.status).toBe(400)
      expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    })

    it('повтор того же ключа+тела → кэшированный ответ, партия НЕ списана дважды', async () => {
      const { orderId, itemId, batchId } = await seedPendingItemWithBatch()
      const key = randomUUID()
      const body = { rawBarcode: TARGET_BARCODE, manualEntry: true }
      const first = await post(`/api/v1/orders/${orderId}/items/${itemId}/scan`).set('Idempotency-Key', key).send(body)
      const afterFirst = await readBatchQuantity(batchId) // после первого вызова, не до — тот же батч на release+reserve даёт net=0
      const second = await post(`/api/v1/orders/${orderId}/items/${itemId}/scan`).set('Idempotency-Key', key).send(body)
      expect(first.status).toBe(200)
      expect(second.body).toEqual(first.body)
      expect(await readBatchQuantity(batchId)).toBe(afterFirst)
    })

    it('тот же ключ, другой rawBarcode → 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
      const { orderId, itemId } = await seedPendingItemWithBatch()
      const key = randomUUID()
      await post(`/api/v1/orders/${orderId}/items/${itemId}/scan`).set('Idempotency-Key', key).send({ rawBarcode: TARGET_BARCODE, manualEntry: true })
      const second = await post(`/api/v1/orders/${orderId}/items/${itemId}/scan`)
        .set('Idempotency-Key', key)
        .send({ rawBarcode: '5000000000012', manualEntry: true })
      expect(second.status).toBe(409)
      expect((second.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
    })
  })

  describe('report-issue', () => {
    async function seedPendingItem(): Promise<{ orderId: string; itemId: string }> {
      const orderId = await seedOrder({ status: 'processing' })
      const itemId = await seedItem({ orderId, fulfillmentStatus: 'pending' })
      return { orderId, itemId }
    }

    async function readItemStatus(itemId: string): Promise<string> {
      const row = await pool.query<{ fulfillment_status: string }>('SELECT fulfillment_status FROM order_items WHERE id = $1', [itemId])
      return row.rows[0]?.fulfillment_status ?? ''
    }

    it('без Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const { orderId, itemId } = await seedPendingItem()
      const res = await post(`/api/v1/orders/${orderId}/items/${itemId}/report-issue`).send({ reason: 'out_of_stock' })
      expect(res.status).toBe(400)
      expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    })

    it('повтор того же ключа+тела → кэшированный ответ, позиция unavailable один раз', async () => {
      const { orderId, itemId } = await seedPendingItem()
      const key = randomUUID()
      const body = { reason: 'out_of_stock' }
      const first = await post(`/api/v1/orders/${orderId}/items/${itemId}/report-issue`).set('Idempotency-Key', key).send(body)
      const second = await post(`/api/v1/orders/${orderId}/items/${itemId}/report-issue`).set('Idempotency-Key', key).send(body)
      expect(first.status).toBe(200)
      expect(second.body).toEqual(first.body)
      expect(await readItemStatus(itemId)).toBe('unavailable')
    })

    it('тот же ключ, другая reason → 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
      const { orderId, itemId } = await seedPendingItem()
      const key = randomUUID()
      await post(`/api/v1/orders/${orderId}/items/${itemId}/report-issue`).set('Idempotency-Key', key).send({ reason: 'out_of_stock' })
      const second = await post(`/api/v1/orders/${orderId}/items/${itemId}/report-issue`)
        .set('Idempotency-Key', key)
        .send({ reason: 'damaged_packaging' })
      expect(second.status).toBe(409)
      expect((second.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
    })
  })

  describe('propose-partial-fulfillment', () => {
    async function seedReadyOrder(): Promise<string> {
      const orderId = await seedOrder({ status: 'processing' })
      await seedItem({ orderId, fulfillmentStatus: 'unavailable' })
      return orderId
    }

    it('без Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const orderId = await seedReadyOrder()
      const res = await post(`/api/v1/orders/${orderId}/propose-partial-fulfillment`).send({})
      expect(res.status).toBe(400)
      expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    })

    it('повтор того же ключа → кэшированный ответ, ровно одна строка запроса', async () => {
      const orderId = await seedReadyOrder()
      const key = randomUUID()
      const first = await post(`/api/v1/orders/${orderId}/propose-partial-fulfillment`).set('Idempotency-Key', key).send({})
      const second = await post(`/api/v1/orders/${orderId}/propose-partial-fulfillment`).set('Idempotency-Key', key).send({})
      expect(first.status).toBe(201)
      expect(second.body).toEqual(first.body)
      expect(await countPartialRequests(orderId)).toBe(1)
    })

    it('тот же ключ, другое (невалидное для схемы, но иначе сериализованное) тело → 409 до валидации', async () => {
      const orderId = await seedReadyOrder()
      const key = randomUUID()
      await post(`/api/v1/orders/${orderId}/propose-partial-fulfillment`).set('Idempotency-Key', key).send({})
      const second = await post(`/api/v1/orders/${orderId}/propose-partial-fulfillment`).set('Idempotency-Key', key).send({ extra: true })
      expect(second.status).toBe(409)
      expect((second.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
    })

    // DTJ-312 доработка (foundIssue приёмки) — ДРУГОЙ Idempotency-Key (не повтор одного и того же
    // запроса, а НОВАЯ попытка, напр. вторая вкладка/перезагрузка) на уже awaiting_customer заказ.
    it('второй propose ДРУГИМ Idempotency-Key при уже awaiting_customer-запросе → 409 PARTIAL_FULFILLMENT_PENDING, в БД ровно одна строка', async () => {
      const orderId = await seedReadyOrder()
      const first = await post(`/api/v1/orders/${orderId}/propose-partial-fulfillment`).set('Idempotency-Key', randomUUID()).send({})
      expect(first.status).toBe(201)

      const second = await post(`/api/v1/orders/${orderId}/propose-partial-fulfillment`).set('Idempotency-Key', randomUUID()).send({})

      expect(second.status).toBe(409)
      expect((second.body as ErrorBody).error.code).toBe('PARTIAL_FULFILLMENT_PENDING')
      expect(await countPartialRequests(orderId)).toBe(1)
    })
  })

  describe('complete-picking', () => {
    async function seedReadyOrder(): Promise<string> {
      const orderId = await seedOrder({ status: 'processing' })
      await seedItem({ orderId, fulfillmentStatus: 'scanned_ok' })
      return orderId
    }

    it('без Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const orderId = await seedReadyOrder()
      const res = await post(`/api/v1/orders/${orderId}/complete-picking`).send({ sealConfirmed: true })
      expect(res.status).toBe(400)
      expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    })

    it('повтор того же ключа+тела → кэшированный ответ, OTP вручения выпущен один раз', async () => {
      const orderId = await seedReadyOrder()
      const key = randomUUID()
      const body = { sealConfirmed: true }
      const first = await post(`/api/v1/orders/${orderId}/complete-picking`).set('Idempotency-Key', key).send(body)
      const second = await post(`/api/v1/orders/${orderId}/complete-picking`).set('Idempotency-Key', key).send(body)
      expect(first.status).toBe(200)
      expect(second.body).toEqual(first.body)
      expect(await countOtpRows(orderId)).toBe(1)
    })

    it('тот же ключ, другой sealConfirmed → 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
      const orderId = await seedReadyOrder()
      const key = randomUUID()
      await post(`/api/v1/orders/${orderId}/complete-picking`).set('Idempotency-Key', key).send({ sealConfirmed: true })
      const second = await post(`/api/v1/orders/${orderId}/complete-picking`).set('Idempotency-Key', key).send({ sealConfirmed: false })
      expect(second.status).toBe(409)
      expect((second.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
    })
  })

  describe('handover-otp/regenerate', () => {
    it('без Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const orderId = await seedPickedUpOrder()
      const res = await post(`/api/v1/orders/${orderId}/handover-otp/regenerate`)
      expect(res.status).toBe(400)
      expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    })

    it('повтор того же ключа → кэшированный ответ, ровно одна новая строка otp_codes', async () => {
      const orderId = await seedPickedUpOrder()
      const before = await countOtpRows(orderId)
      const key = randomUUID()
      const first = await post(`/api/v1/orders/${orderId}/handover-otp/regenerate`).set('Idempotency-Key', key)
      const second = await post(`/api/v1/orders/${orderId}/handover-otp/regenerate`).set('Idempotency-Key', key)
      expect(first.status).toBe(201)
      expect(second.body).toEqual(first.body)
      expect((await countOtpRows(orderId)) - before).toBe(1)
    })

    it('тот же ключ, другое тело → 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
      const orderId = await seedPickedUpOrder()
      const key = randomUUID()
      await post(`/api/v1/orders/${orderId}/handover-otp/regenerate`).set('Idempotency-Key', key).send({})
      const second = await post(`/api/v1/orders/${orderId}/handover-otp/regenerate`).set('Idempotency-Key', key).send({ extra: true })
      expect(second.status).toBe(409)
      expect((second.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
    })
  })
})
