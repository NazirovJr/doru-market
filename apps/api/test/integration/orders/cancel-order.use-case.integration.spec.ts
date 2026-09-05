/**
 * Интеграционный тест `CancelOrderUseCase` (EP-09, DTJ-232) — РЕАЛЬНЫЙ Postgres через
 * `OrdersFacade` + `DrizzleOrderRepository` (DTJ-227), не мок/фейк (урок волны 5 §6.4,
 * `reports/EP09-CTO-BRIEF.md`).
 *
 * D-EP09-27: `OrderRepositoryPort` до этой волны стоял на null-адаптере — этот файл становится
 * зелёным только после того, как DTJ-227 подключит настоящий Drizzle-репозиторий. Если он
 * красный ИМЕННО по этой причине (`OrderRepositoryPort.save() has no implementation yet`) —
 * это не дефект DTJ-232, см. `blockers` отчёта сдачи.
 *
 * `InventoryFacadePort`/`RefundFacadePort` — по-прежнему `vi.fn()`-моки: фокус этого файла —
 * реальная персистентность отмены (D-EP09-27), не денежные/складские адаптеры (у них свой
 * периметр — EP-05/EP-11).
 *
 * Уборка (правило 5 AGENTS.md): `afterEach` удаляет только строки, созданные ЭТИМ тестом,
 * по id (`tenants` каскадом тянет `orders`/`order_items`/`pharmacy_inventory`/`users` — ON
 * DELETE CASCADE/RESTRICT смешаны в схеме, поэтому чистим явно, в порядке FK).
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
import { CancelOrderUseCase } from '@/modules/orders/application/order-lifecycle/cancel-order.use-case.js'
import type { InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import type { RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import type { CancelOrderActor } from '@/modules/orders/application/order-lifecycle/dto/cancel-order-command.dto.js'

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

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-09-02T12:00:00.000Z')
  }
}

const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

describe.skipIf(!postgresAvailable)('CancelOrderUseCase — integration (DTJ-232, D-EP09-27)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let useCase: CancelOrderUseCase
  let releaseStock: ReturnType<typeof vi.fn<InventoryFacadePort['releaseStock']>>
  let refundFull: ReturnType<typeof vi.fn<RefundFacadePort['refundFull']>>
  let tenantId: string
  let pharmacyId: string
  let customerId: string
  let medicineId: string
  let inventoryBatchId: string
  /** `orders.tenant_id`/`customer_id` — `ON DELETE RESTRICT` (не CASCADE) — `orders`/`order_items`
   * своих строк обязаны удаляться ДО tenant/user в `afterEach`, иначе `DELETE FROM tenants` падает
   * на FK-констрейнте. */
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
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [id, `dtj232-${id.slice(0, 8)}`])
    return id
  }

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy DTJ-232', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000001')`,
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

  /** Формат `OrderNumber.parse()` (`shared-kernel/domain/value-objects/order-number.vo.ts`) —
   * строго `DTJ-NNNNNN-NNNNN` (6+5 цифр); произвольная строка не проходит `hydrate()`. Счётчик
   * модуля — для уникальности внутри одного прогона файла (`orders.order_number` UNIQUE). */
  let orderNumberSeq = 0
  function nextOrderNumber(): string {
    orderNumberSeq += 1
    return `DTJ-260902-${String(orderNumberSeq).padStart(5, '0')}`
  }

  /** Прямая вставка `orders`/`order_items` (не через `Order.create()`) — минимальная строка,
   * достаточная для `DrizzleOrderRepository.findById()`/`save()` round-trip. */
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
    }
    refundFull = vi.fn<RefundFacadePort['refundFull']>().mockResolvedValue(ok(undefined))
    const refundFacade: RefundFacadePort = { refundFull }
    const ordersFacade = new OrdersFacade(new DrizzleOrderRepository(db))
    useCase = new CancelOrderUseCase(ordersFacade, inventoryFacade, refundFacade, new FixedClock(), SILENT_LOGGER)
  })

  afterEach(async () => {
    // orders.tenant_id/customer_id — ON DELETE RESTRICT (см. комментарий у createdOrderIds) —
    // order_items/orders своих строк удаляются ПЕРВЫМИ, иначе DELETE FROM tenants/users падает на FK.
    await pool.query('DELETE FROM order_items WHERE order_id = ANY($1)', [createdOrderIds]).catch(() => undefined)
    await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacy_inventory WHERE id = $1', [inventoryBatchId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM medicines WHERE id = $1', [medicineId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [customerId]).catch(() => undefined)
  })

  it('non-cash paid_escrow, customer → статус cancelled в БД, cancel_reason сохранён, refundFull вызван', async () => {
    const orderId = await seedOrder('paid_escrow', 'alif_mobi')
    const actor: CancelOrderActor = { userId: customerId, role: 'customer', tenantId, pharmacyId: null }

    const result = await useCase.execute({ orderId, actor, reason: 'customer_changed_mind' })

    expect(result).toEqual({ orderId, status: 'cancelled', refundIssued: true })
    expect(refundFull).toHaveBeenCalledTimes(1)
    expect(releaseStock).toHaveBeenCalledTimes(1)
    const row = await pool.query<{ status: string; cancel_reason: string }>(
      'SELECT status, cancel_reason FROM orders WHERE id = $1',
      [orderId],
    )
    expect(row.rows[0]?.status).toBe('cancelled')
    expect(row.rows[0]?.cancel_reason).toBe('customer_changed_mind')
  })

  it('cash confirmed, customer → статус cancelled в БД, refundFull НЕ вызван (D-EP09-29)', async () => {
    const orderId = await seedOrder('confirmed', 'cash_courier')
    const actor: CancelOrderActor = { userId: customerId, role: 'customer', tenantId, pharmacyId: null }

    const result = await useCase.execute({ orderId, actor, reason: 'customer_changed_mind' })

    expect(result.refundIssued).toBe(false)
    expect(refundFull).not.toHaveBeenCalled()
    const row = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId])
    expect(row.rows[0]?.status).toBe('cancelled')
  })

  it('D-EP09-30: двойная отмена против реальной БД — второй вызов бросает, releaseStock/refundFull — по одному разу', async () => {
    const orderId = await seedOrder('paid_escrow', 'alif_mobi')
    const actor: CancelOrderActor = { userId: customerId, role: 'customer', tenantId, pharmacyId: null }

    await useCase.execute({ orderId, actor, reason: 'customer_changed_mind' })
    await expect(useCase.execute({ orderId, actor, reason: 'customer_changed_mind' })).rejects.toThrow()

    expect(releaseStock).toHaveBeenCalledTimes(1)
    expect(refundFull).toHaveBeenCalledTimes(1)
  })
})
