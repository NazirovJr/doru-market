// DTJ-309 — RBAC/tenant-isolation по 9 реальным маршрутам терминала (не 11 — GET /orders/:id нет, см. отчёт). Harness общий, см. orders/__tests__/test-app.ts.
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

const TENANT_ID = 'd3091d30-91d3-4d30-8d30-91d3091d3091'
const TARGET_BARCODE = '4006381333931'

let orderNumberSeq = 0
function nextOrderNumber(): string {
  orderNumberSeq += 1
  return `DTJ-260925-${String(orderNumberSeq).padStart(5, '0')}`
}
let batchNumberSeq = 0
function nextBatchNumber(): string {
  batchNumberSeq += 1
  return `BATCH-DTJ309-${String(batchNumberSeq).padStart(4, '0')}`
}

describe.skipIf(!postgresAvailable)('Pharmacy terminal RBAC/tenant isolation — Supertest integration (DTJ-309)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let chainOwn: string
  let chainForeign: string
  let pharmacyHome: string
  let pharmacyForeign: string
  let categoryId: number
  let medicineId: string
  let customerId: string
  const createdUserIds: string[] = []
  const createdOrderIds: string[] = []
  const createdBatchIds: string[] = []
  const createdOtpIds: string[] = []

  async function seedChain(name: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status) VALUES ($1, $2, $3, $4, 'active')`,
      [id, name, `${name} LLC`, `TIN-DTJ309-${randomUUID().slice(0, 8)}`],
    )
    return id
  }

  async function seedPharmacy(chainId: string, name: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, $3, 'Dushanbe, test str. 309', 38.5598, 68.7870, '+992900000309', 'active')`,
      [id, chainId, name],
    )
    return id
  }

  async function seedUser(role: 'customer' | 'pharmacist' | 'pharmacy_admin'): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, $3)`, [id, TENANT_ID, role])
    createdUserIds.push(id)
    return id
  }

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  interface ActorTokenOptions {
    readonly role: 'pharmacist' | 'pharmacy_admin'
    readonly pharmacyId: string
    readonly chainId: string
    readonly userId: string
  }

  function actorToken(options: ActorTokenOptions): string {
    return sign({ sub: options.userId, role: options.role, tenantId: TENANT_ID, pharmacyId: options.pharmacyId, chainId: options.chainId })
  }

  function superAdminToken(): string {
    return sign({ sub: randomUUID(), role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })
  }

  interface SeedOrderOptions {
    readonly pharmacyId: string
    readonly status: string
    readonly assignedPharmacistId?: string | null
    readonly slaDeadlineAt?: Date | null
    readonly handoverOtpId?: string | null
  }

  async function seedOrder(options: SeedOrderOptions): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, payment_transaction_id,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id,
          checkout_attempt_id, assigned_pharmacist_id, sla_deadline_at, handover_otp_id)
       VALUES ($1, $2, $3, $4, 'alif_mobi', $5, 'mock_txn_309', 20.00, 5.00, 25.00, 'x', $6, $7, $8, $9, $10)`,
      [
        id,
        nextOrderNumber(),
        customerId,
        options.pharmacyId,
        options.status,
        TENANT_ID,
        randomUUID(),
        options.assignedPharmacistId ?? null,
        options.slaDeadlineAt ?? null,
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

  async function seedItem(options: SeedItemOptions): Promise<string> { // inventory_batch_id/item_issue_reason — доменные invariants, не null
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
      [pharmacyHome, medicineId, quantity, nextBatchNumber()],
    )
    const id = row.rows[0]?.id
    if (id === undefined) throw new Error('seedBatch: no id returned')
    createdBatchIds.push(id)
    return id
  }

  /** `issuedMinutesAgo` — regenerate's min-interval (default 60s) требует прошедшего времени. */
  async function seedHandoverOtp(orderIdForSubject: string, issuedMinutesAgo = 5): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO otp_codes (id, tenant_id, subject_ref, purpose, code_hash, plain_code, issued_at, expires_at)
       VALUES ($1, $2, $3, 'delivery_handover', $4, '1234', NOW() - ($5 || ' minutes')::interval, NOW() + INTERVAL '15 minutes')`,
      [id, TENANT_ID, orderIdForSubject, 'a'.repeat(64), String(issuedMinutesAgo)],
    )
    createdOtpIds.push(id)
    return id
  }

  async function seedPickedUpOrder(pharmacyId: string, issuedMinutesAgo = 5): Promise<string> {
    const orderId = randomUUID()
    const otpId = await seedHandoverOtp(orderId, issuedMinutesAgo)
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, payment_transaction_id,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id,
          checkout_attempt_id, handover_otp_id)
       VALUES ($1, $2, $3, $4, 'alif_mobi', 'picked_up', 'mock_txn_309', 20.00, 5.00, 25.00, 'x', $5, $6, $7)`,
      [orderId, nextOrderNumber(), customerId, pharmacyId, TENANT_ID, randomUUID(), otpId],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  function withAuth(req: request.Test, token: string): request.Test {
    return req.set('Authorization', `Bearer ${token}`)
  }

  function withIdemKey(req: request.Test, key = randomUUID()): request.Test {
    return req.set('Idempotency-Key', key)
  }

  const queueReq = (token: string, query = ''): request.Test =>
    withAuth(request(httpServer).get(`/api/v1/orders?sort=priority${query}`), token)
  const acceptReq = (orderId: string, token: string): request.Test =>
    withIdemKey(withAuth(request(httpServer).post(`/api/v1/orders/${orderId}/accept`), token))
  const reclaimReq = (orderId: string, token: string): request.Test =>
    withIdemKey(withAuth(request(httpServer).post(`/api/v1/orders/${orderId}/reclaim`), token)).send({ reason: 'shift_change' })
  const scanReq = (orderId: string, itemId: string, token: string): request.Test =>
    withIdemKey(withAuth(request(httpServer).post(`/api/v1/orders/${orderId}/items/${itemId}/scan`), token)).send({
      rawBarcode: TARGET_BARCODE,
      manualEntry: true,
    })
  const reportIssueReq = (orderId: string, itemId: string, token: string): request.Test =>
    withIdemKey(withAuth(request(httpServer).post(`/api/v1/orders/${orderId}/items/${itemId}/report-issue`), token)).send({
      reason: 'out_of_stock',
    })
  const proposeReq = (orderId: string, token: string): request.Test =>
    withIdemKey(withAuth(request(httpServer).post(`/api/v1/orders/${orderId}/propose-partial-fulfillment`), token)).send({})
  const completePickingReq = (orderId: string, token: string): request.Test =>
    withIdemKey(withAuth(request(httpServer).post(`/api/v1/orders/${orderId}/complete-picking`), token)).send({
      sealConfirmed: true,
    })
  const getHandoverOtpReq = (orderId: string, token: string): request.Test =>
    withAuth(request(httpServer).get(`/api/v1/orders/${orderId}/handover-otp`), token)
  const regenerateReq = (orderId: string, token: string): request.Test =>
    withIdemKey(withAuth(request(httpServer).post(`/api/v1/orders/${orderId}/handover-otp/regenerate`), token))

  function expectDenied(status: number): void {
    expect([403, 404]).toContain(status)
  }

  function expectInsufficientRole(res: request.Response): void {
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      'test-dtj-309',
    ])
    chainOwn = await seedChain('DTJ-309 Own chain')
    chainForeign = await seedChain('DTJ-309 Foreign chain')
    pharmacyHome = await seedPharmacy(chainOwn, 'DTJ-309 Home pharmacy')
    pharmacyForeign = await seedPharmacy(chainForeign, 'DTJ-309 Foreign pharmacy')
    const category = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('dtj-309-root', 'Корень', 'Root', 'Root', 'otc', 0, true)
       ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug RETURNING id`,
    )
    categoryId = category.rows[0]?.id ?? 0
    const medicine = await pool.query<{ id: string }>(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode, barcode)
       VALUES (gen_random_uuid(), 'DTJ-309 medicine', 'DTJ-309 INN', $1, 'таблетки', 'tablet', '500 мг',
               'Tajikistan', 'Test Pharma', false, 'none', true, false, true, $2)
       RETURNING id`,
      [categoryId, TARGET_BARCODE],
    )
    medicineId = medicine.rows[0]?.id ?? ''
    customerId = await seedUser('customer')

    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
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
      await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [[pharmacyHome, pharmacyForeign]])
      await pool.query('DELETE FROM pharmacy_chains WHERE id = ANY($1)', [[chainOwn, chainForeign]])
      await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  describe('GET /orders (очередь)', () => {
    it('а) pharmacist чужой аптеки с filter[pharmacyId] своей → 403', async () => {
      const foreignPharmacist = await seedUser('pharmacist')
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignPharmacist })
      const res = await queueReq(token, `&filter[pharmacyId]=${pharmacyHome}`)
      expectDenied(res.status)
    })

    it('б) pharmacist своей аптеки → 200, видит свой заказ', async () => {
      const homePharmacist = await seedUser('pharmacist')
      const orderId = await seedOrder({ pharmacyId: pharmacyHome, status: 'paid_escrow' })
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyHome, chainId: chainOwn, userId: homePharmacist })
      const res = await queueReq(token)
      expect(res.status).toBe(200)
      const ids = (res.body as { data: { id: string }[] }).data.map((row) => row.id)
      expect(ids).toContain(orderId)
    })

    it('в) pharmacy_admin чужой сети с filter[pharmacyId] своей → 403', async () => {
      const foreignAdmin = await seedUser('pharmacy_admin')
      const token = actorToken({ role: 'pharmacy_admin', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignAdmin })
      const res = await queueReq(token, `&filter[pharmacyId]=${pharmacyHome}`)
      expectDenied(res.status)
    })

    it('г) super_admin → 403 INSUFFICIENT_ROLE', async () => {
      const res = await queueReq(superAdminToken())
      expectInsufficientRole(res)
    })
  })

  describe('POST /orders/:id/accept', () => {
    it('а) pharmacist чужой аптеки → 403/404', async () => {
      const foreignPharmacist = await seedUser('pharmacist')
      const orderId = await seedOrder({ pharmacyId: pharmacyHome, status: 'paid_escrow' })
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignPharmacist })
      expectDenied((await acceptReq(orderId, token)).status)
    })

    it('б) pharmacist своей аптеки → 200', async () => {
      const homePharmacist = await seedUser('pharmacist')
      const orderId = await seedOrder({ pharmacyId: pharmacyHome, status: 'paid_escrow' })
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyHome, chainId: chainOwn, userId: homePharmacist })
      expect((await acceptReq(orderId, token)).status).toBe(200)
    })

    it('в) pharmacy_admin чужой сети → 403/404', async () => {
      const foreignAdmin = await seedUser('pharmacy_admin')
      const orderId = await seedOrder({ pharmacyId: pharmacyHome, status: 'paid_escrow' })
      const token = actorToken({ role: 'pharmacy_admin', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignAdmin })
      expectDenied((await acceptReq(orderId, token)).status)
    })

    it('г) super_admin → 403 INSUFFICIENT_ROLE', async () => {
      const orderId = await seedOrder({ pharmacyId: pharmacyHome, status: 'paid_escrow' })
      expectInsufficientRole(await acceptReq(orderId, superAdminToken()))
    })
  })

  describe('POST /orders/:id/reclaim', () => {
    async function seedProcessingOrder(): Promise<string> {
      const holder = await seedUser('pharmacist')
      return seedOrder({ pharmacyId: pharmacyHome, status: 'processing', assignedPharmacistId: holder })
    }

    it('а) pharmacist чужой аптеки → 403/404', async () => {
      const foreignPharmacist = await seedUser('pharmacist')
      const orderId = await seedProcessingOrder()
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignPharmacist })
      expectDenied((await reclaimReq(orderId, token)).status)
    })

    it('б) pharmacist своей аптеки → 200', async () => {
      const homePharmacist = await seedUser('pharmacist')
      const orderId = await seedProcessingOrder()
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyHome, chainId: chainOwn, userId: homePharmacist })
      expect((await reclaimReq(orderId, token)).status).toBe(200)
    })

    it('в) pharmacy_admin чужой сети → 403/404', async () => {
      const foreignAdmin = await seedUser('pharmacy_admin')
      const orderId = await seedProcessingOrder()
      const token = actorToken({ role: 'pharmacy_admin', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignAdmin })
      expectDenied((await reclaimReq(orderId, token)).status)
    })

    it('г) super_admin → 403 INSUFFICIENT_ROLE', async () => {
      const orderId = await seedProcessingOrder()
      expectInsufficientRole(await reclaimReq(orderId, superAdminToken()))
    })
  })

  describe('POST /orders/:id/items/:itemId/scan', () => {
    async function seedPendingItem(): Promise<{ orderId: string; itemId: string }> {
      const orderId = await seedOrder({ pharmacyId: pharmacyHome, status: 'processing' })
      const itemId = await seedItem({ orderId, fulfillmentStatus: 'pending' })
      return { orderId, itemId }
    }

    it('а) pharmacist чужой аптеки → 403/404', async () => {
      const foreignPharmacist = await seedUser('pharmacist')
      const { orderId, itemId } = await seedPendingItem()
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignPharmacist })
      expectDenied((await scanReq(orderId, itemId, token)).status)
    })

    it('б) pharmacist своей аптеки, валидный штрихкод → 200', async () => {
      const homePharmacist = await seedUser('pharmacist')
      const batchId = await seedBatch(10)
      const { orderId, itemId } = await seedPendingItem()
      await pool.query('UPDATE order_items SET inventory_batch_id = $1 WHERE id = $2', [batchId, itemId])
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyHome, chainId: chainOwn, userId: homePharmacist })
      expect((await scanReq(orderId, itemId, token)).status).toBe(200)
    })

    it('в) pharmacy_admin (роль недопустима на scan) → 403', async () => {
      const foreignAdmin = await seedUser('pharmacy_admin')
      const { orderId, itemId } = await seedPendingItem()
      const token = actorToken({ role: 'pharmacy_admin', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignAdmin })
      expectInsufficientRole(await scanReq(orderId, itemId, token))
    })

    it('г) super_admin → 403 INSUFFICIENT_ROLE', async () => {
      const { orderId, itemId } = await seedPendingItem()
      expectInsufficientRole(await scanReq(orderId, itemId, superAdminToken()))
    })
  })

  describe('POST /orders/:id/items/:itemId/report-issue', () => {
    async function seedPendingItem(): Promise<{ orderId: string; itemId: string }> {
      const orderId = await seedOrder({ pharmacyId: pharmacyHome, status: 'processing' })
      const itemId = await seedItem({ orderId, fulfillmentStatus: 'pending' })
      return { orderId, itemId }
    }

    it('а) pharmacist чужой аптеки → 403/404', async () => {
      const foreignPharmacist = await seedUser('pharmacist')
      const { orderId, itemId } = await seedPendingItem()
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignPharmacist })
      expectDenied((await reportIssueReq(orderId, itemId, token)).status)
    })

    it('б) pharmacist своей аптеки → 200', async () => {
      const homePharmacist = await seedUser('pharmacist')
      const { orderId, itemId } = await seedPendingItem()
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyHome, chainId: chainOwn, userId: homePharmacist })
      expect((await reportIssueReq(orderId, itemId, token)).status).toBe(200)
    })

    it('в) pharmacy_admin (роль недопустима на report-issue) → 403', async () => {
      const foreignAdmin = await seedUser('pharmacy_admin')
      const { orderId, itemId } = await seedPendingItem()
      const token = actorToken({ role: 'pharmacy_admin', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignAdmin })
      expectInsufficientRole(await reportIssueReq(orderId, itemId, token))
    })

    it('г) super_admin → 403 INSUFFICIENT_ROLE', async () => {
      const { orderId, itemId } = await seedPendingItem()
      expectInsufficientRole(await reportIssueReq(orderId, itemId, superAdminToken()))
    })
  })

  describe('POST /orders/:id/propose-partial-fulfillment', () => {
    async function seedReadyOrder(): Promise<string> {
      const orderId = await seedOrder({ pharmacyId: pharmacyHome, status: 'processing' })
      await seedItem({ orderId, fulfillmentStatus: 'unavailable' })
      return orderId
    }

    it('а) pharmacist чужой аптеки → 403/404', async () => {
      const foreignPharmacist = await seedUser('pharmacist')
      const orderId = await seedReadyOrder()
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignPharmacist })
      expectDenied((await proposeReq(orderId, token)).status)
    })

    it('б) pharmacist своей аптеки → 201', async () => {
      const homePharmacist = await seedUser('pharmacist')
      const orderId = await seedReadyOrder()
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyHome, chainId: chainOwn, userId: homePharmacist })
      expect((await proposeReq(orderId, token)).status).toBe(201)
    })

    it('в) pharmacy_admin (роль недопустима на propose) → 403', async () => {
      const foreignAdmin = await seedUser('pharmacy_admin')
      const orderId = await seedReadyOrder()
      const token = actorToken({ role: 'pharmacy_admin', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignAdmin })
      expectInsufficientRole(await proposeReq(orderId, token))
    })

    it('г) super_admin → 403 INSUFFICIENT_ROLE', async () => {
      const orderId = await seedReadyOrder()
      expectInsufficientRole(await proposeReq(orderId, superAdminToken()))
    })
  })

  describe('POST /orders/:id/complete-picking', () => {
    async function seedReadyOrder(): Promise<string> {
      const orderId = await seedOrder({ pharmacyId: pharmacyHome, status: 'processing' })
      await seedItem({ orderId, fulfillmentStatus: 'scanned_ok' })
      return orderId
    }

    it('а) pharmacist чужой аптеки → 403/404', async () => {
      const foreignPharmacist = await seedUser('pharmacist')
      const orderId = await seedReadyOrder()
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignPharmacist })
      expectDenied((await completePickingReq(orderId, token)).status)
    })

    it('б) pharmacist своей аптеки → 200', async () => {
      const homePharmacist = await seedUser('pharmacist')
      const orderId = await seedReadyOrder()
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyHome, chainId: chainOwn, userId: homePharmacist })
      expect((await completePickingReq(orderId, token)).status).toBe(200)
    })

    it('в) pharmacy_admin (роль недопустима на complete-picking) → 403', async () => {
      const foreignAdmin = await seedUser('pharmacy_admin')
      const orderId = await seedReadyOrder()
      const token = actorToken({ role: 'pharmacy_admin', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignAdmin })
      expectInsufficientRole(await completePickingReq(orderId, token))
    })

    it('г) super_admin → 403 INSUFFICIENT_ROLE', async () => {
      const orderId = await seedReadyOrder()
      expectInsufficientRole(await completePickingReq(orderId, superAdminToken()))
    })
  })

  describe('GET /orders/:id/handover-otp', () => {
    it('а) pharmacist чужой аптеки → 403/404', async () => {
      const foreignPharmacist = await seedUser('pharmacist')
      const orderId = await seedPickedUpOrder(pharmacyHome)
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignPharmacist })
      expectDenied((await getHandoverOtpReq(orderId, token)).status)
    })

    it('б) pharmacist своей аптеки → 200, код совпадает с сохранённым', async () => {
      const homePharmacist = await seedUser('pharmacist')
      const orderId = await seedPickedUpOrder(pharmacyHome)
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyHome, chainId: chainOwn, userId: homePharmacist })
      const res = await getHandoverOtpReq(orderId, token)
      expect(res.status).toBe(200)
      expect((res.body as { data: { code: string } }).data.code).toBe('1234')
    })

    it('в) pharmacy_admin чужой сети → 403/404', async () => {
      const foreignAdmin = await seedUser('pharmacy_admin')
      const orderId = await seedPickedUpOrder(pharmacyHome)
      const token = actorToken({ role: 'pharmacy_admin', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignAdmin })
      expectDenied((await getHandoverOtpReq(orderId, token)).status)
    })

    // super_admin не в @Roles(...) ни на одном из 9 маршрутов (SRS-PHT-004) — см. «Допущения» отчёта.
    it('г) super_admin → 403 INSUFFICIENT_ROLE (см. «Допущения» отчёта)', async () => {
      const orderId = await seedPickedUpOrder(pharmacyHome)
      expectInsufficientRole(await getHandoverOtpReq(orderId, superAdminToken()))
    })
  })

  describe('POST /orders/:id/handover-otp/regenerate', () => {
    it('а) pharmacist чужой аптеки → 403/404', async () => {
      const foreignPharmacist = await seedUser('pharmacist')
      const orderId = await seedPickedUpOrder(pharmacyHome)
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignPharmacist })
      expectDenied((await regenerateReq(orderId, token)).status)
    })

    it('б) pharmacist своей аптеки → 201', async () => {
      const homePharmacist = await seedUser('pharmacist')
      const orderId = await seedPickedUpOrder(pharmacyHome)
      const token = actorToken({ role: 'pharmacist', pharmacyId: pharmacyHome, chainId: chainOwn, userId: homePharmacist })
      expect((await regenerateReq(orderId, token)).status).toBe(201)
    })

    it('в) pharmacy_admin чужой сети → 403/404', async () => {
      const foreignAdmin = await seedUser('pharmacy_admin')
      const orderId = await seedPickedUpOrder(pharmacyHome)
      const token = actorToken({ role: 'pharmacy_admin', pharmacyId: pharmacyForeign, chainId: chainForeign, userId: foreignAdmin })
      expectDenied((await regenerateReq(orderId, token)).status)
    })

    it('г) super_admin → 403 INSUFFICIENT_ROLE (см. «Допущения» отчёта)', async () => {
      const orderId = await seedPickedUpOrder(pharmacyHome)
      expectInsufficientRole(await regenerateReq(orderId, superAdminToken()))
    })
  })
})
