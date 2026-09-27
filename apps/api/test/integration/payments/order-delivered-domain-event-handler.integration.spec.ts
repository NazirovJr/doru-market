// delivered -> capture эскроу ровно один раз через DomainEventsRouter-путь, не HTTP-мост (retired).
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { OrderDeliveredDomainEventHandler } from '@/modules/payments/infrastructure/subscribers/order-delivered.domain-event-handler.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
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

describe.skipIf(!postgresAvailable)('OrderDeliveredDomainEventHandler — integration (DTJ-317)', () => {
  let pool: Pool
  let testApp: TestApp
  let handler: OrderDeliveredDomainEventHandler
  let tenantId: string
  let pharmacyId: string
  let customerId: string
  let medicineId: string
  const createdOrderIds: string[] = []
  let orderNumberSeq = 0

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

  beforeAll(async () => {
    testApp = await createTestApp()
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    handler = testApp.app.get(OrderDeliveredDomainEventHandler)

    tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj317-${tenantId.slice(0, 8)}`])
    await pool.query(`INSERT INTO tenant_settings (tenant_id, brand_name, hold_period_days) VALUES ($1, 'DTJ-317 Test Brand', 5)`, [tenantId])
    pharmacyId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone) VALUES ($1, 'DTJ-317 Test Pharmacy', 'x', 38.5, 68.7, '+992900000006')`,
      [pharmacyId],
    )
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
    const categoryId = await resolveRootCategoryId()
    medicineId = randomUUID()
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, true)`,
      [medicineId, `Trade-${medicineId}`, `INN-${medicineId}`, categoryId],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM medicines WHERE id = $1', [medicineId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [customerId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [tenantId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    await pool.end().catch(() => undefined)
    await testApp.close()
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM payout_schedule WHERE order_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM escrow_ledger WHERE order_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM processed_events WHERE event_id = ANY($1)', [[orderId]]).catch(() => undefined)
      await pool.query('DELETE FROM order_items WHERE order_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => undefined)
    }
  })

  async function seedOrder(): Promise<string> {
    const orderId = randomUUID()
    orderNumberSeq += 1
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address,
          tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'processing', 'alif_mobi', 200.00, 0.00, 200.00, 'Dushanbe, Rudaki 1', $5, $6)`,
      [orderId, `DTJ317-${String(orderNumberSeq).padStart(5, '0')}`, customerId, pharmacyId, tenantId, randomUUID()],
    )
    await pool.query(
      `INSERT INTO order_items (id, order_id, medicine_id, unit_price_tjs, quantity, total_price_tjs, commission_bps, platform_fee_diram)
       VALUES (gen_random_uuid(), $1, $2, 100.00, 2, 200.00, 800, 1600)`,
      [orderId, medicineId],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  it('дубль envelope (тот же eventId) через DomainEventsRouter-путь -> escrow_ledger захвачен РОВНО один раз', async () => {
    const orderId = await seedOrder()
    const eventId = randomUUID()
    const envelope: DomainEventEnvelope = {
      eventId,
      eventType: 'OrderDeliveredEvent',
      aggregateType: 'delivery_assignment',
      aggregateId: randomUUID(),
      tenantId,
      occurredAt: new Date().toISOString(),
      payload: { orderId, deliveredAt: new Date().toISOString() },
    }

    await handler.handle(envelope)
    await handler.handle(envelope)

    const ledgerRows = await pool.query('SELECT id FROM escrow_ledger WHERE order_id = $1', [orderId])
    const payoutRows = await pool.query('SELECT id FROM payout_schedule WHERE order_id = $1', [orderId])
    expect(ledgerRows.rows).toHaveLength(2) // platform_fee_captured + captured_to_pharmacy, не 4
    expect(payoutRows.rows).toHaveLength(1)
  })
})
