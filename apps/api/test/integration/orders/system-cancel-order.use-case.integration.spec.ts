/**
 * Интеграционный тест `SystemCancelOrderUseCase` (EP-10, DTJ-253/254) — РЕАЛЬНЫЙ Postgres через
 * `OrdersFacade` + `DrizzleOrderRepository` (тот же приём, что `cancel-order.use-case.
 * integration.spec.ts`, DTJ-232 — сокращённый/переиспользованный набор seed-хелперов, focus
 * ЭТОГО файла — реальная персистентность СИСТЕМНОЙ отмены + защита от гонки статуса, не
 * дублирование покрытия `CancelOrderUseCase`, которое уже доказано соседним файлом).
 * `InventoryFacadePort`/`RefundFacadePort` — по-прежнему `vi.fn()`-моки (тот же периметр, что
 * сосед).
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { ok } from '@dorutj/domain-kernel'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import { DrizzleOrderRepository } from '@/modules/orders/infrastructure/repositories/order.repository.js'
import { SystemCancelOrderUseCase } from '@/modules/orders/application/order-lifecycle/system-cancel-order.use-case.js'
import type { InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import type { RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'

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

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-09-04T03:00:00.000Z')
  }
}

const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

describe.skipIf(!postgresAvailable)('SystemCancelOrderUseCase — integration (DTJ-253/254)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let useCase: SystemCancelOrderUseCase
  let releaseStock: ReturnType<typeof vi.fn<InventoryFacadePort['releaseStock']>>
  let refundFull: ReturnType<typeof vi.fn<RefundFacadePort['refundFull']>>
  let tenantId: string
  let pharmacyId: string
  let customerId: string
  let medicineId: string
  let inventoryBatchId: string
  let createdOrderIds: string[]

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

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

  async function seedTenant(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [id, `dtj253-${id.slice(0, 8)}`])
    return id
  }

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy DTJ-253', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000002')`,
      [id],
    )
    return id
  }

  async function seedCustomer(forTenantId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [id, forTenantId])
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
      [id, `Trade-${id}`, `INN-${id}`, categoryId],
    )
    return id
  }

  async function seedInventoryBatch(forPharmacyId: string, forMedicineId: string): Promise<string> {
    const batch = await pool.query<{ id: string }>(
      `INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
       VALUES (gen_random_uuid(), $1, $2, 1000, 50, CURRENT_DATE + INTERVAL '1 year', 'BATCH-1')
       RETURNING id`,
      [forPharmacyId, forMedicineId],
    )
    const id = batch.rows[0]?.id
    if (id === undefined) throw new Error('seedInventoryBatch: no id returned')
    return id
  }

  let orderNumberSeq = 0
  function nextOrderNumber(): string {
    orderNumberSeq += 1
    return `DTJ-260904-${String(orderNumberSeq).padStart(5, '0')}`
  }

  async function seedOrder(status: string, paymentMethod: string): Promise<string> {
    const orderId = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address,
          tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, $5, $6, 20.00, 5.00, 25.00, 'Dushanbe, Rudaki 1', $7, $8)`,
      [orderId, nextOrderNumber(), customerId, pharmacyId, status, paymentMethod, tenantId, randomUUID()],
    )
    await pool.query(
      `INSERT INTO order_items
         (id, order_id, medicine_id, unit_price_tjs, quantity, total_price_tjs,
          commission_bps, platform_fee_diram, inventory_batch_id)
       VALUES (gen_random_uuid(), $1, $2, 10.00, 2, 20.00, 800, 160, $3)`,
      [orderId, medicineId, inventoryBatchId],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  beforeEach(async () => {
    createdOrderIds = []
    tenantId = await seedTenant()
    pharmacyId = await seedPharmacy()
    customerId = await seedCustomer(tenantId)
    medicineId = await seedMedicine()
    inventoryBatchId = await seedInventoryBatch(pharmacyId, medicineId)
    releaseStock = vi.fn<InventoryFacadePort['releaseStock']>().mockResolvedValue(undefined)
    const inventoryFacade: InventoryFacadePort = {
      reserveStock: vi.fn(),
      releaseStock,
      hasExpiredReservedBatch: vi.fn(),
      getStockQuantity: vi.fn(),
      reserveForOrder: vi.fn(),
      reconcileZeroStock: vi.fn(),
    }
    refundFull = vi.fn<RefundFacadePort['refundFull']>().mockResolvedValue(ok(undefined))
    const refundFacade: RefundFacadePort = { refundFull, refundPartialFulfillment: vi.fn() }
    const ordersFacade = new OrdersFacade(new DrizzleOrderRepository(db))
    useCase = new SystemCancelOrderUseCase(ordersFacade, inventoryFacade, refundFacade, new FixedClock(), SILENT_LOGGER)
  })

  afterEach(async () => {
    await pool.query('DELETE FROM order_items WHERE order_id = ANY($1)', [createdOrderIds]).catch(() => undefined)
    await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacy_inventory WHERE id = $1', [inventoryBatchId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM medicines WHERE id = $1', [medicineId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [customerId]).catch(() => undefined)
  })

  it('DTJ-253: non-cash pending_payment, reason=payment_timeout → cancelled в БД, refundFull НЕ вызван (ещё не в эскроу)', async () => {
    const orderId = await seedOrder('pending_payment', 'alif_mobi')

    const result = await useCase.execute({ tenantId, orderId, expectedFromStatus: 'pending_payment', reason: 'payment_timeout' })

    expect(result).toEqual({ orderId, status: 'cancelled', refundIssued: false })
    expect(refundFull).not.toHaveBeenCalled()
    expect(releaseStock).toHaveBeenCalledTimes(1)
    const row = await pool.query<{ status: string; cancel_reason: string }>('SELECT status, cancel_reason FROM orders WHERE id = $1', [orderId])
    expect(row.rows[0]).toEqual({ status: 'cancelled', cancel_reason: 'payment_timeout' })
  })

  it('DTJ-254: non-cash paid_escrow, reason=pickup_sla_timeout → cancelled в БД, refundFull вызван ровно один раз', async () => {
    const orderId = await seedOrder('paid_escrow', 'alif_mobi')

    const result = await useCase.execute({ tenantId, orderId, expectedFromStatus: 'paid_escrow', reason: 'pickup_sla_timeout' })

    expect(result).toEqual({ orderId, status: 'cancelled', refundIssued: true })
    expect(refundFull).toHaveBeenCalledExactlyOnceWith(orderId, 'pickup_sla_timeout')
  })

  it('DTJ-254: cash confirmed, reason=pickup_sla_timeout → cancelled в БД, refundFull НЕ вызван (D-25)', async () => {
    const orderId = await seedOrder('confirmed', 'cash_courier')

    const result = await useCase.execute({ tenantId, orderId, expectedFromStatus: 'confirmed', reason: 'pickup_sla_timeout' })

    expect(result).toEqual({ orderId, status: 'cancelled', refundIssued: false })
    expect(refundFull).not.toHaveBeenCalled()
  })

  it('гонка: заказ УЖЕ paid_escrow в БД, джоба ожидала pending_payment → skipped, статус в БД НЕ тронут', async () => {
    const orderId = await seedOrder('paid_escrow', 'alif_mobi')

    const result = await useCase.execute({ tenantId, orderId, expectedFromStatus: 'pending_payment', reason: 'payment_timeout' })

    expect(result).toEqual({ orderId, status: 'skipped', refundIssued: false })
    expect(releaseStock).not.toHaveBeenCalled()
    const row = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId])
    expect(row.rows[0]?.status).toBe('paid_escrow') // НЕ cancelled
  })
})
