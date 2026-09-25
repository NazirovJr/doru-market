/**
 * `GET /api/v1/orders/:id` (экран сборки терминала) — Supertest против РЕАЛЬНЫХ Postgres,
 * реального `CatalogFacadeAdapter` (не мок — проверяет реальный batch-join `medicineName`,
 * не N+1). Тот же харнесс, что `pharmacy-terminal-items.controller.integration.spec.ts`.
 */
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
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
  readonly error: { readonly code: string }
}
interface OrderDetailItemBody {
  readonly id: string
  readonly medicineName: string
}
interface OrderDetailBody {
  readonly id: string
  readonly orderNumber: string
  readonly items: readonly OrderDetailItemBody[]
}

const TENANT_ID = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
const OTHER_TENANT_ID = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3'

let orderNumberSeq = 0
function nextOrderNumber(): string {
  orderNumberSeq += 1
  return `DTJ-260907-${String(orderNumberSeq).padStart(5, '0')}`
}

describe.skipIf(!postgresAvailable)('GET /orders/:id — Supertest integration (DTJ-311)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let ownChainId: string
  let foreignChainId: string
  let pharmacyA: string
  let pharmacyB: string
  let pharmacyForeign: string
  let categoryId: number
  let medicineId: string
  let customerId: string
  const createdOrderIds: string[] = []
  const createdUserIds: string[] = []
  const createdPharmacyIds: string[] = []
  const createdChainIds: string[] = []
  const createdBatchIds: string[] = []

  async function seedChain(name: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status) VALUES ($1, $2, $3, $4, 'active')`,
      [id, name, `${name} LLC`, `TIN-DTJ311-${randomUUID().slice(0, 8)}`],
    )
    createdChainIds.push(id)
    return id
  }

  async function seedPharmacy(chainId: string, name: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, $3, 'Dushanbe, test str. 311', 38.5598, 68.7870, '+992900000311', 'active')`,
      [id, chainId, name],
    )
    createdPharmacyIds.push(id)
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

  async function seedMedicine(tradeName: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, false)`,
      [id, tradeName, `INN-${id}`, categoryId],
    )
    return id
  }

  async function seedUser(role: 'customer' | 'pharmacist' | 'pharmacy_admin', tenantId = TENANT_ID): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, $3)`, [id, tenantId, role])
    createdUserIds.push(id)
    return id
  }

  /** Домен требует `inventory_batch_id` (не-null) при гидратации заказа — реальная партия, не заглушка. */
  async function seedBatch(forPharmacyId: string): Promise<string> {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
       VALUES (gen_random_uuid(), $1, $2, 1000, 10, CURRENT_DATE + INTERVAL '1 year', $3)
       RETURNING id`,
      [forPharmacyId, medicineId, `BATCH-DTJ311-${randomUUID().slice(0, 8)}`],
    )
    const id = row.rows[0]?.id
    if (id === undefined) throw new Error('seedBatch: no id returned')
    createdBatchIds.push(id)
    return id
  }

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  interface SeedOrderOptions {
    readonly pharmacyId: string
    readonly tenantId?: string
  }

  async function seedOrderWithItem(options: SeedOrderOptions): Promise<{ orderId: string; itemId: string }> {
    const orderId = randomUUID()
    const batchId = await seedBatch(options.pharmacyId)
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address,
          tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'processing', 'cash_courier', 20.00, 5.00, 25.00, 'Dushanbe, Rudaki 1', $5, $6)`,
      [orderId, nextOrderNumber(), customerId, options.pharmacyId, options.tenantId ?? TENANT_ID, randomUUID()],
    )
    const item = await pool.query<{ id: string }>(
      `INSERT INTO order_items
         (id, order_id, medicine_id, unit_price_tjs, quantity, total_price_tjs, commission_bps, platform_fee_diram, inventory_batch_id, fulfillment_status)
       VALUES (gen_random_uuid(), $1, $2, 10.00, 2, 20.00, 800, 160, $3, 'pending')
       RETURNING id`,
      [orderId, medicineId, batchId],
    )
    const itemId = item.rows[0]?.id
    if (itemId === undefined) throw new Error('seedOrderWithItem: no id returned')
    createdOrderIds.push(orderId)
    return { orderId, itemId }
  }

  function detailRequest(orderId: string, token: string): request.Test {
    return request(httpServer).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${token}`)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      'test-orders-311',
    ])
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      OTHER_TENANT_ID,
      'test-orders-311-other',
    ])
    ownChainId = await seedChain('Test Chain DTJ-311 Own')
    foreignChainId = await seedChain('Test Chain DTJ-311 Foreign')
    pharmacyA = await seedPharmacy(ownChainId, 'Pharmacy A (DTJ-311)')
    pharmacyB = await seedPharmacy(ownChainId, 'Pharmacy B (DTJ-311)')
    pharmacyForeign = await seedPharmacy(foreignChainId, 'Pharmacy Foreign (DTJ-311)')
    categoryId = await resolveRootCategoryId()
    medicineId = await seedMedicine('Парацетамол 500мг (DTJ-311)')
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
      await pool.query('DELETE FROM order_items WHERE order_id = ANY($1)', [createdOrderIds]).catch(() => undefined)
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds]).catch(() => undefined)
      await pool.query('DELETE FROM pharmacy_inventory WHERE id = ANY($1)', [createdBatchIds]).catch(() => undefined)
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]).catch(() => undefined)
      await pool.query('DELETE FROM medicines WHERE id = $1', [medicineId]).catch(() => undefined)
      await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [createdPharmacyIds]).catch(() => undefined)
      await pool.query('DELETE FROM pharmacy_chains WHERE id = ANY($1)', [createdChainIds]).catch(() => undefined)
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[TENANT_ID, OTHER_TENANT_ID]]).catch(() => undefined)
      await pool.end().catch(() => undefined)
    }
  })

  it('pharmacist своей аптеки — 200, позиция несёт medicineName из реального каталога (batch-join)', async () => {
    const pharmacist = await seedUser('pharmacist')
    const { orderId } = await seedOrderWithItem({ pharmacyId: pharmacyA })
    const token = sign({ sub: pharmacist, role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })

    const res = await detailRequest(orderId, token)

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<OrderDetailBody>).data
    expect(body.id).toBe(orderId)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.medicineName).toBe('Парацетамол 500мг (DTJ-311)')
  })

  it('pharmacist ЧУЖОЙ аптеки той же сети — 403 (не владелец, не admin)', async () => {
    const pharmacist = await seedUser('pharmacist')
    const { orderId } = await seedOrderWithItem({ pharmacyId: pharmacyA })
    const token = sign({ sub: pharmacist, role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: pharmacyB, chainId: ownChainId })

    const res = await detailRequest(orderId, token)

    expect(res.status).toBe(403)
  })

  it('заказ ЧУЖОГО тенанта — 404 (существование не подтверждается)', async () => {
    const pharmacist = await seedUser('pharmacist')
    const { orderId } = await seedOrderWithItem({ pharmacyId: pharmacyA })
    const token = sign({ sub: pharmacist, role: 'pharmacist', tenantId: OTHER_TENANT_ID, pharmacyId: pharmacyA, chainId: null })

    const res = await detailRequest(orderId, token)

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('pharmacy_admin своей сети, заказ ДРУГОЙ точки — 200 (агрегированный доступ по chainId)', async () => {
    const admin = await seedUser('pharmacy_admin')
    const { orderId } = await seedOrderWithItem({ pharmacyId: pharmacyB })
    const token = sign({ sub: admin, role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })

    const res = await detailRequest(orderId, token)

    expect(res.status).toBe(200)
    expect((res.body as SuccessBody<OrderDetailBody>).data.id).toBe(orderId)
  })

  it('pharmacy_admin — заказ ЧУЖОЙ сети — 403 (межсетевая изоляция)', async () => {
    const admin = await seedUser('pharmacy_admin')
    const { orderId } = await seedOrderWithItem({ pharmacyId: pharmacyForeign })
    const token = sign({ sub: admin, role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })

    const res = await detailRequest(orderId, token)

    expect(res.status).toBe(403)
  })
})
