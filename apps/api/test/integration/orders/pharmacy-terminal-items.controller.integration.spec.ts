/**
 * `PharmacyTerminalItemsController` — Supertest integration (DTJ-302/303, EP-12 §A.3/A.4) —
 * РЕАЛЬНЫЙ Postgres, реальные `CatalogFacadeAdapter`/`InventoryFacadeAdapter` (не моки, урок
 * волны 5 §6.4, `reports/EP09-CTO-BRIEF.md`) — единственный файл, реально исполняющий
 * `Barcode.parse()`/контрольную цифру EAN-13 и SQL-запросы обоих адаптеров сквозным HTTP-путём
 * (юнит-тесты обоих use case мокают `CatalogFacadePort`/`InventoryFacadePort` целиком).
 *
 * `TARGET_BARCODE`/`OTHER_BARCODE` — НАСТОЯЩИЕ валидные EAN-13 (контрольная цифра проверена
 * вручную по алгоритму GS1, `packages/domain-kernel/src/value-objects/barcode.vo.ts`), с
 * префиксом ≠ '2' (D-06) — иначе `Barcode.isGloballyIdentifiable()` вернул бы `false` и штрихкод
 * резолвился бы через `pharmacy_sku_mapping` (internal_sku), а не `medicines.barcode`.
 *
 * Покрывает: TC-PHT-004/012 (чужой медикамент → 404), TC-PHT-005/013 (уже scanned_ok → 409),
 * TC-PHT-006 (просроченная партия-замена → 422 EXPIRED_STOCK, старая партия не тронута),
 * TC-PHT-007 (валидная замена → 200, release(old)+reserve(new) по реальным SQL), TC-PHT-029
 * (партия ДРУГОЙ аптеки → 422 BATCH_NOT_AVAILABLE), Idempotency-Key на `scan` (партия не
 * списывается дважды), TC-PHT-008 (report-issue out_of_stock → 200), precondition-негатив
 * (report-issue на уже scanned_ok → 422 BUSINESS_RULE_VIOLATION), Idempotency-Key на
 * `report-issue` (переход в unavailable не повторяется).
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
interface OrderItemBody {
  readonly id: string
  readonly fulfillmentStatus: string
  readonly scannedBatchId: string | null
  readonly itemIssueReason: string | null
}

const TENANT_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
/** Валидный EAN-13 (контрольная цифра 1, префикс '4') — целевой медикамент этой позиции. */
const TARGET_BARCODE = '4006381333931'
/** Валидный EAN-13 (контрольная цифра 2, префикс '5') — ДРУГОЙ медикамент (TC-PHT-004/012). */
const OTHER_BARCODE = '5000000000012'

let orderNumberSeq = 0
function nextOrderNumber(): string {
  orderNumberSeq += 1
  return `DTJ-260905-${String(orderNumberSeq).padStart(5, '0')}`
}

let batchNumberSeq = 0
function nextBatchNumber(): string {
  batchNumberSeq += 1
  return `BATCH-PHT-${String(batchNumberSeq).padStart(4, '0')}`
}

describe.skipIf(!postgresAvailable)('PharmacyTerminalItemsController — Supertest integration (DTJ-302/303)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let pharmacyId: string
  let otherPharmacyId: string
  let categoryId: number
  let medicineId: string
  let otherMedicineId: string
  let customerId: string
  let pharmacistId: string
  let pharmacistToken: string
  const createdOrderIds: string[] = []
  const createdBatchIds: string[] = []

  async function seedPharmacy(name: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone) VALUES ($1, $2, 'Dushanbe, test str. 302', 38.5598, 68.7870, '+992900000302')`,
      [id, name],
    )
    return id
  }

  async function resolveRootCategoryId(): Promise<number> {
    const category = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('root', 'Корень', 'Root', 'Root', 'otc', 0, true)
       ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
       RETURNING id`,
    )
    const id = category.rows[0]?.id
    if (id === undefined) throw new Error('resolveRootCategoryId: no id returned')
    return id
  }

  async function seedMedicine(barcode: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode, barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, true, $5)`,
      [id, `Trade-${id}`, `INN-${id}`, categoryId, barcode],
    )
    return id
  }

  async function seedCustomer(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [id, TENANT_ID])
    return id
  }

  async function seedPharmacistUser(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'pharmacist')`, [id, TENANT_ID])
    return id
  }

  function signPharmacist(userId: string, forPharmacyId: string): string {
    return jwtSigner.sign({
      sub: userId,
      role: 'pharmacist',
      tenantId: TENANT_ID,
      pharmacyId: forPharmacyId,
      chainId: null,
      sessionId: randomUUID(),
    })
  }

  interface SeedBatchOptions {
    readonly quantity: number
    /** SQL-интервал, напр. `'+1 year'`/`'-1 day'` — подставляется в `CURRENT_DATE + INTERVAL`. */
    readonly expiresAtInterval: string
    readonly batchNumber?: string
  }

  async function seedBatch(forPharmacyId: string, forMedicineId: string, options: SeedBatchOptions): Promise<{ id: string; batchNumber: string }> {
    const batchNumber = options.batchNumber ?? nextBatchNumber()
    const sign = options.expiresAtInterval.trim().startsWith('-') ? '-' : '+'
    const magnitude = options.expiresAtInterval.replace(/^[+-]/u, '')
    const row = await pool.query<{ id: string }>(
      `INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
       VALUES (gen_random_uuid(), $1, $2, 1000, $3, CURRENT_DATE ${sign} INTERVAL '${magnitude}', $4)
       RETURNING id`,
      [forPharmacyId, forMedicineId, options.quantity, batchNumber],
    )
    const id = row.rows[0]?.id
    if (id === undefined) throw new Error('seedBatch: no id returned')
    createdBatchIds.push(id)
    return { id, batchNumber }
  }

  interface SeedOrderWithItemOptions {
    readonly inventoryBatchId: string
    readonly medicineId: string
    readonly quantity: number
    readonly fulfillmentStatus?: string
  }

  async function seedOrderWithItem(options: SeedOrderWithItemOptions): Promise<{ orderId: string; itemId: string }> {
    const { inventoryBatchId, medicineId: forMedicineId, quantity, fulfillmentStatus = 'pending' } = options
    const orderId = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address,
          tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'processing', 'cash_courier', 20.00, 5.00, 25.00, 'Dushanbe, Rudaki 1', $5, $6)`,
      [orderId, nextOrderNumber(), customerId, pharmacyId, TENANT_ID, randomUUID()],
    )
    const item = await pool.query<{ id: string }>(
      `INSERT INTO order_items
         (id, order_id, medicine_id, unit_price_tjs, quantity, total_price_tjs,
          commission_bps, platform_fee_diram, inventory_batch_id, fulfillment_status)
       VALUES (gen_random_uuid(), $1, $2, 10.00, $3, $4, 800, 160, $5, $6)
       RETURNING id`,
      [orderId, forMedicineId, quantity, (10 * quantity).toFixed(2), inventoryBatchId, fulfillmentStatus],
    )
    const itemId = item.rows[0]?.id
    if (itemId === undefined) throw new Error('seedOrderWithItem: no id returned')
    createdOrderIds.push(orderId)
    return { orderId, itemId }
  }

  function scanRequest(orderId: string, itemId: string, idempotencyKey: string): request.Test {
    return request(httpServer)
      .post(`/api/v1/orders/${orderId}/items/${itemId}/scan`)
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .set('Idempotency-Key', idempotencyKey)
  }

  function reportIssueRequest(orderId: string, itemId: string, idempotencyKey: string): request.Test {
    return request(httpServer)
      .post(`/api/v1/orders/${orderId}/items/${itemId}/report-issue`)
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .set('Idempotency-Key', idempotencyKey)
  }

  async function readBatchQuantity(batchId: string): Promise<number> {
    const row = await pool.query<{ quantity: number }>('SELECT quantity FROM pharmacy_inventory WHERE id = $1', [batchId])
    const quantity = row.rows[0]?.quantity
    if (quantity === undefined) throw new Error('readBatchQuantity: no row')
    return quantity
  }

  async function readItem(itemId: string): Promise<{ fulfillmentStatus: string; inventoryBatchId: string }> {
    const row = await pool.query<{ fulfillment_status: string; inventory_batch_id: string }>(
      'SELECT fulfillment_status, inventory_batch_id FROM order_items WHERE id = $1',
      [itemId],
    )
    const r = row.rows[0]
    if (r === undefined) throw new Error('readItem: no row')
    return { fulfillmentStatus: r.fulfillment_status, inventoryBatchId: r.inventory_batch_id }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      'test-orders-302',
    ])
    pharmacyId = await seedPharmacy('Test Pharmacy DTJ-302-A')
    otherPharmacyId = await seedPharmacy('Test Pharmacy DTJ-302-B')
    categoryId = await resolveRootCategoryId()
    medicineId = await seedMedicine(TARGET_BARCODE)
    otherMedicineId = await seedMedicine(OTHER_BARCODE)
    customerId = await seedCustomer()
    pharmacistId = await seedPharmacistUser()

    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    pharmacistToken = signPharmacist(pharmacistId, pharmacyId)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM order_items WHERE order_id = ANY($1)', [createdOrderIds]).catch(() => undefined)
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds]).catch(() => undefined)
      await pool.query('DELETE FROM pharmacy_inventory WHERE id = ANY($1)', [createdBatchIds]).catch(() => undefined)
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [[customerId, pharmacistId]]).catch(() => undefined)
      await pool.query('DELETE FROM medicines WHERE id = ANY($1)', [[medicineId, otherMedicineId]]).catch(() => undefined)
      await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [[pharmacyId, otherPharmacyId]]).catch(() => undefined)
      await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID]).catch(() => undefined)
      await pool.end().catch(() => undefined)
    }
  })

  describe('scan (SRS-PHT-011..016)', () => {
    it('TC-PHT-004/012 — штрихкод резолвится в ДРУГОЙ медикамент → 404 ORDER_ITEM_NOT_FOUND, позиция остаётся pending', async () => {
      const batch = await seedBatch(pharmacyId, medicineId, { quantity: 10, expiresAtInterval: '+1 year' })
      const { orderId, itemId } = await seedOrderWithItem({ inventoryBatchId: batch.id, medicineId, quantity: 2 })

      const res = await scanRequest(orderId, itemId, randomUUID()).send({ rawBarcode: OTHER_BARCODE, manualEntry: false })

      expect(res.status).toBe(404)
      expect((res.body as ErrorBody).error.code).toBe('ORDER_ITEM_NOT_FOUND')
      const item = await readItem(itemId)
      expect(item.fulfillmentStatus).toBe('pending')
    })

    it('TC-PHT-005/013 — позиция уже scanned_ok → 409 ITEM_ALREADY_SCANNED', async () => {
      const batch = await seedBatch(pharmacyId, medicineId, { quantity: 10, expiresAtInterval: '+1 year' })
      const { orderId, itemId } = await seedOrderWithItem({ inventoryBatchId: batch.id, medicineId, quantity: 2, fulfillmentStatus: 'scanned_ok' })

      const res = await scanRequest(orderId, itemId, randomUUID()).send({ rawBarcode: TARGET_BARCODE, manualEntry: false })

      expect(res.status).toBe(409)
      expect((res.body as ErrorBody).error.code).toBe('ITEM_ALREADY_SCANNED')
    })

    it('TC-PHT-006 — scannedBatchNumber ссылается на просроченную партию → 422 EXPIRED_STOCK, старая партия не тронута', async () => {
      const original = await seedBatch(pharmacyId, medicineId, { quantity: 10, expiresAtInterval: '+1 year' })
      const expired = await seedBatch(pharmacyId, medicineId, { quantity: 10, expiresAtInterval: '-1 day' })
      const { orderId, itemId } = await seedOrderWithItem({ inventoryBatchId: original.id, medicineId, quantity: 2 })

      const res = await scanRequest(orderId, itemId, randomUUID()).send({
        rawBarcode: TARGET_BARCODE,
        manualEntry: false,
        scannedBatchNumber: expired.batchNumber,
      })

      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.code).toBe('EXPIRED_STOCK')
      const item = await readItem(itemId)
      expect(item.fulfillmentStatus).toBe('pending')
      expect(item.inventoryBatchId).toBe(original.id)
      expect(await readBatchQuantity(original.id)).toBe(10)
    })

    it('TC-PHT-007 — валидная партия того же товара/аптеки → 200, release(old)+reserve(new) по реальным SQL', async () => {
      const original = await seedBatch(pharmacyId, medicineId, { quantity: 10, expiresAtInterval: '+1 year' })
      const substitute = await seedBatch(pharmacyId, medicineId, { quantity: 5, expiresAtInterval: '+1 year' })
      const { orderId, itemId } = await seedOrderWithItem({ inventoryBatchId: original.id, medicineId, quantity: 2 })

      const res = await scanRequest(orderId, itemId, randomUUID()).send({
        rawBarcode: TARGET_BARCODE,
        manualEntry: true,
        scannedBatchNumber: substitute.batchNumber,
      })

      expect(res.status).toBe(200)
      const body = (res.body as SuccessBody<OrderItemBody>).data
      expect(body.fulfillmentStatus).toBe('scanned_ok')
      expect(body.scannedBatchId).toBe(substitute.id)
      // releaseStock возвращает quantity=2 обратно на старую партию (10 → 12).
      expect(await readBatchQuantity(original.id)).toBe(12)
      // reserveForOrder списывает quantity=2 с новой партии (5 → 3).
      expect(await readBatchQuantity(substitute.id)).toBe(3)
      const item = await readItem(itemId)
      expect(item.inventoryBatchId).toBe(substitute.id)
    })

    it('TC-PHT-029 — партия того же товара, ДРУГОЙ аптеки → 422 BATCH_NOT_AVAILABLE', async () => {
      const original = await seedBatch(pharmacyId, medicineId, { quantity: 10, expiresAtInterval: '+1 year' })
      const otherPharmacyBatch = await seedBatch(otherPharmacyId, medicineId, { quantity: 10, expiresAtInterval: '+1 year' })
      const { orderId, itemId } = await seedOrderWithItem({ inventoryBatchId: original.id, medicineId, quantity: 2 })

      const res = await scanRequest(orderId, itemId, randomUUID()).send({
        rawBarcode: TARGET_BARCODE,
        manualEntry: false,
        scannedBatchNumber: otherPharmacyBatch.batchNumber,
      })

      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.code).toBe('BATCH_NOT_AVAILABLE')
      expect(await readBatchQuantity(original.id)).toBe(10)
    })

    it('Idempotency-Key — повтор с тем же ключом и телом не выполняет use case дважды, партия не списывается дважды', async () => {
      const original = await seedBatch(pharmacyId, medicineId, { quantity: 10, expiresAtInterval: '+1 year' })
      const substitute = await seedBatch(pharmacyId, medicineId, { quantity: 5, expiresAtInterval: '+1 year' })
      const { orderId, itemId } = await seedOrderWithItem({ inventoryBatchId: original.id, medicineId, quantity: 2 })
      const idempotencyKey = randomUUID()
      const requestBody = { rawBarcode: TARGET_BARCODE, manualEntry: false, scannedBatchNumber: substitute.batchNumber }

      const res1 = await scanRequest(orderId, itemId, idempotencyKey).send(requestBody)
      const res2 = await scanRequest(orderId, itemId, idempotencyKey).send(requestBody)

      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
      expect(res2.body).toEqual(res1.body)
      // Списано РОВНО один раз (5 → 3), не дважды (что дало бы 1).
      expect(await readBatchQuantity(substitute.id)).toBe(3)
      expect(await readBatchQuantity(original.id)).toBe(12)
    })
  })

  describe('report-issue (SRS-PHT-017/018)', () => {
    it('TC-PHT-008 — reason=out_of_stock на pending-позиции → 200, unavailable/out_of_stock', async () => {
      const batch = await seedBatch(pharmacyId, medicineId, { quantity: 10, expiresAtInterval: '+1 year' })
      const { orderId, itemId } = await seedOrderWithItem({ inventoryBatchId: batch.id, medicineId, quantity: 2 })

      const res = await reportIssueRequest(orderId, itemId, randomUUID()).send({ reason: 'out_of_stock' })

      expect(res.status).toBe(200)
      const body = (res.body as SuccessBody<OrderItemBody>).data
      expect(body.fulfillmentStatus).toBe('unavailable')
      expect(body.itemIssueReason).toBe('out_of_stock')
      const item = await readItem(itemId)
      expect(item.fulfillmentStatus).toBe('unavailable')
    })

    it('precondition-негатив — report-issue на уже scanned_ok позиции → 422 BUSINESS_RULE_VIOLATION', async () => {
      const batch = await seedBatch(pharmacyId, medicineId, { quantity: 10, expiresAtInterval: '+1 year' })
      const { orderId, itemId } = await seedOrderWithItem({ inventoryBatchId: batch.id, medicineId, quantity: 2, fulfillmentStatus: 'scanned_ok' })

      const res = await reportIssueRequest(orderId, itemId, randomUUID()).send({ reason: 'damaged_packaging' })

      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.code).toBe('BUSINESS_RULE_VIOLATION')
      const item = await readItem(itemId)
      expect(item.fulfillmentStatus).toBe('scanned_ok')
    })

    it('Idempotency-Key — повтор с тем же ключом и телом не дублирует переход в unavailable', async () => {
      const batch = await seedBatch(pharmacyId, medicineId, { quantity: 10, expiresAtInterval: '+1 year' })
      const { orderId, itemId } = await seedOrderWithItem({ inventoryBatchId: batch.id, medicineId, quantity: 2 })
      const idempotencyKey = randomUUID()
      const requestBody = { reason: 'expired_on_shelf' }

      const res1 = await reportIssueRequest(orderId, itemId, idempotencyKey).send(requestBody)
      const res2 = await reportIssueRequest(orderId, itemId, idempotencyKey).send(requestBody)

      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
      expect(res2.body).toEqual(res1.body)
      const item = await readItem(itemId)
      expect(item.fulfillmentStatus).toBe('unavailable')
    })
  })
})
