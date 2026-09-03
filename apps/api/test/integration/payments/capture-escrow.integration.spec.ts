/**
 * Интеграционный тест `CaptureEscrowUseCase` (EP-10, DTJ-244) — РЕАЛЬНЫЙ Postgres, тот же
 * `createTestApp()` харнесс, что `dtj-243-webhook-edge-cases.integration.spec.ts`. Фокус —
 * новая инфраструктура, невыразимая на моках: `PayoutScheduleRepository.insertPending` (реальный
 * INSERT + ON CONFLICT), `ProcessedEventsPort.markProcessed` (составной PK), `PaymentsTenancyAdapter`
 * (реальное чтение `tenant_settings.hold_period_days`), `getOrderByIdLocking` с order_items (DTJ-244
 * расширение `PaymentsOrderSnapshot`).
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CaptureEscrowUseCase } from '@/modules/payments/application/use-cases/capture-escrow.use-case.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const HOLD_PERIOD_DAYS = 5

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

describe.skipIf(!postgresAvailable)('CaptureEscrowUseCase — integration (DTJ-244)', () => {
  let pool: Pool
  let testApp: TestApp
  let useCase: CaptureEscrowUseCase
  let tenantId: string
  let customerId: string
  let pharmacyId: string
  let medicineId: string
  let inventoryBatchId: string
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
    useCase = testApp.app.get(CaptureEscrowUseCase)

    tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj244-${tenantId.slice(0, 8)}`])
    await pool.query(`INSERT INTO tenant_settings (tenant_id, brand_name, hold_period_days) VALUES ($1, 'DTJ-244 Test Brand', $2)`, [
      tenantId,
      HOLD_PERIOD_DAYS,
    ])
    pharmacyId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone) VALUES ($1, 'DTJ-244 Test Pharmacy', 'x', 38.5, 68.7, '+992900000004')`,
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
    const batch = await pool.query<{ id: string }>(
      `INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
       VALUES (gen_random_uuid(), $1, $2, 1000, 50, CURRENT_DATE + INTERVAL '1 year', 'BATCH-1')
       RETURNING id`,
      [pharmacyId, medicineId],
    )
    inventoryBatchId = batch.rows[0]!.id
  })

  afterAll(async () => {
    await pool.query('DELETE FROM pharmacy_inventory WHERE id = $1', [inventoryBatchId]).catch(() => undefined)
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

  async function seedOrder(status: string, paymentMethod: string): Promise<string> {
    const orderId = randomUUID()
    orderNumberSeq += 1
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address,
          tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, $5, $6, 200.00, 0.00, 200.00, 'Dushanbe, Rudaki 1', $7, $8)`,
      [orderId, `DTJ-260904-${String(orderNumberSeq).padStart(5, '0')}`, customerId, pharmacyId, status, paymentMethod, tenantId, randomUUID()],
    )
    await pool.query(
      `INSERT INTO order_items
         (id, order_id, medicine_id, unit_price_tjs, quantity, total_price_tjs,
          commission_bps, platform_fee_diram, inventory_batch_id)
       VALUES (gen_random_uuid(), $1, $2, 100.00, 2, 200.00, 800, 1600, $3)`,
      [orderId, medicineId, inventoryBatchId],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  it('AC1: non-cash заказ delivered → escrow_ledger 2 строки, payout_schedule pending с holdPeriodDays из tenant_settings', async () => {
    const orderId = await seedOrder('processing', 'alif_mobi')
    const eventId = randomUUID()

    await useCase.execute({ tenantId, orderId, eventId })

    const ledgerRows = await pool.query<{ entry_type: string; amount_diram: string }>(
      'SELECT entry_type, amount_diram FROM escrow_ledger WHERE order_id = $1 ORDER BY entry_type',
      [orderId],
    )
    expect(ledgerRows.rows).toHaveLength(2)
    const platformFee = ledgerRows.rows.find((r) => r.entry_type === 'platform_fee_captured')
    const captured = ledgerRows.rows.find((r) => r.entry_type === 'captured_to_pharmacy')
    expect(platformFee?.amount_diram).toBe('1600')
    expect(captured?.amount_diram).toBe('18400') // 20000 - 1600 (2 позиции * 1000TJS в диramах = 20000)

    const payoutRows = await pool.query<{ status: string; gross_amount_diram: string; commission_diram: string; net_amount_diram: string; hold_period_days: number }>(
      'SELECT status, gross_amount_diram, commission_diram, net_amount_diram, hold_period_days FROM payout_schedule WHERE order_id = $1',
      [orderId],
    )
    expect(payoutRows.rows).toHaveLength(1)
    expect(payoutRows.rows[0]).toMatchObject({
      status: 'pending',
      gross_amount_diram: '20000',
      commission_diram: '1600',
      net_amount_diram: '18400',
      hold_period_days: HOLD_PERIOD_DAYS,
    })
  })

  it('AC2: то же событие (eventId) доставлено ПОВТОРНО — escrow_ledger/payout_schedule НЕ дублируются', async () => {
    const orderId = await seedOrder('processing', 'alif_mobi')
    const eventId = randomUUID()

    await useCase.execute({ tenantId, orderId, eventId })
    await useCase.execute({ tenantId, orderId, eventId })

    const ledgerRows = await pool.query('SELECT id FROM escrow_ledger WHERE order_id = $1', [orderId])
    const payoutRows = await pool.query('SELECT id FROM payout_schedule WHERE order_id = $1', [orderId])
    expect(ledgerRows.rows).toHaveLength(2)
    expect(payoutRows.rows).toHaveLength(1)
  })

  it('AC3: cash_courier заказ delivered → ни escrow_ledger, ни payout_schedule не получают строк', async () => {
    const orderId = await seedOrder('confirmed', 'cash_courier')

    await useCase.execute({ tenantId, orderId, eventId: randomUUID() })

    const ledgerRows = await pool.query('SELECT id FROM escrow_ledger WHERE order_id = $1', [orderId])
    const payoutRows = await pool.query('SELECT id FROM payout_schedule WHERE order_id = $1', [orderId])
    expect(ledgerRows.rows).toHaveLength(0)
    expect(payoutRows.rows).toHaveLength(0)
  })
})
