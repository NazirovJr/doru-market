/**
 * Интеграционный тест `DrizzleOrderRepository` (EP-09, DTJ-227) — РЕАЛЬНЫЙ Postgres, не
 * мок/фейк (урок волны 5 §6.4, `reports/EP09-CTO-BRIEF.md`).
 *
 * Фокус: `save()`/`findById()`/`findByCheckoutAttemptId()` — полный круг через
 * `Order.create()` (домен) → Drizzle-репозиторий → `Order.restore()`, включая денежные поля
 * (`Money.toDbDecimalTjs`/`fromDbDecimalTjs`, TJS-decimal колонки ↔ diram), `GeoPoint`,
 * `OrderNumber`, состояние (D-25 — `cash_courier` восстанавливается как `confirmed`). Upsert
 * (правило 6 волны 5): повторный `save()` того же `Order` после мутации через `confirm()`
 * персистит НОВОЕ состояние, не создаёт вторую строку.
 *
 * Уборка (правило 5 AGENTS.md): `afterEach` удаляет только строки, созданные ЭТИМ тестом, по
 * id, в порядке FK (`order_items` → `orders` → `tenants`/`pharmacies`/`medicines`/`users`).
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { DrizzleOrderRepository } from '@/modules/orders/infrastructure/repositories/order.repository.js'
import { Order } from '@/modules/orders/domain/order.entity.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'
import { COD_LIMIT_DEFAULT_DIRAM, type OrderCreateCommand } from '@/modules/orders/domain/order-create-command.js'

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

describe.skipIf(!postgresAvailable)('DrizzleOrderRepository — integration (DTJ-227)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let repo: DrizzleOrderRepository
  let tenantId: string
  let pharmacyId: string
  let customerId: string
  let medicineId: string
  let inventoryBatchId: string
  let createdOrderIds: string[]

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    repo = new DrizzleOrderRepository(db)
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
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [id, `dtj227-${id.slice(0, 8)}`])
    return id
  }

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy DTJ-227', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000002')`,
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

  beforeEach(async () => {
    createdOrderIds = []
    tenantId = await seedTenant()
    pharmacyId = await seedPharmacy()
    customerId = await seedCustomer(tenantId)
    medicineId = await seedMedicine()
    inventoryBatchId = await seedInventoryBatch(pharmacyId, medicineId)
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

  function buildCommand(overrides: Partial<OrderCreateCommand> = {}): OrderCreateCommand {
    const geo = GeoPoint.create(38.5598, 68.787)
    if (!geo.ok) throw new Error('fixture: invalid GeoPoint')
    const unitPrice = Money.fromDiram(100_00n)
    const deliveryFee = Money.fromDiram(50_00n)
    const itemsTotal = unitPrice.multiplyByQuantity(2)
    return {
      id: randomUUID(),
      orderNumber: OrderNumber.fromParts('260902', Math.floor(Math.random() * 90_000) + 1),
      tenantId,
      customerId,
      pharmacyId,
      items: [
        {
          id: randomUUID(),
          medicineId,
          pharmacyId,
          unitPrice,
          quantity: 2,
          commissionBps: 800,
          inventoryBatchId,
          isPrescriptionRequired: false,
          controlCategory: 'none',
        },
      ],
      deliveryAddress: 'Dushanbe, Rudaki 1',
      deliveryLandmark: 'near the bridge',
      deliveryGeoPoint: geo.value,
      deliveryFee,
      totalAmount: itemsTotal.add(deliveryFee),
      paymentMethod: 'cash_courier',
      billingStrategy: 'single_invoice',
      prescriptionId: null,
      checkoutAttemptId: randomUUID(),
      isPharmacyActiveAtCreation: true,
      codLimitDiram: COD_LIMIT_DEFAULT_DIRAM,
      now: new Date('2026-09-02T12:00:00.000Z'),
      ...overrides,
    }
  }

  async function createSavedOrder(overrides: Partial<OrderCreateCommand> = {}): Promise<Order> {
    const created = Order.create(buildCommand(overrides))
    if (!created.ok) throw new Error(`fixture: Order.create failed: ${created.error.message}`)
    createdOrderIds.push(created.value.id)
    await repo.save(created.value)
    return created.value
  }

  async function findOrThrow(orderId: string): Promise<Order> {
    const found = await repo.findById(tenantId, orderId)
    if (found === null) throw new Error('fixture: expected order to be found')
    return found
  }

  it('save() → findById() — статус/итог/orderNumber (D-25 confirmed для cash_courier)', async () => {
    const order = await createSavedOrder()
    const found = await findOrThrow(order.id)

    expect(found.status).toBe('confirmed')
    expect(found.orderNumber.value).toBe(order.orderNumber.value)
    expect(found.totalAmount.diram).toBe(order.totalAmount.diram)
    expect(found.itemsTotal.diram).toBe(order.itemsTotal.diram)
  })

  it('save() → findById() — GeoPoint/landmark/позиции (unitPrice/commissionBps/inventoryBatchId)', async () => {
    const order = await createSavedOrder()
    const found = await findOrThrow(order.id)
    const geo = found.deliveryGeoPoint
    if (geo === null) throw new Error('fixture: expected deliveryGeoPoint to round-trip')
    const item = found.items[0]
    if (item === undefined) throw new Error('fixture: expected exactly one item')

    expect(geo.latitude).toBeCloseTo(38.5598, 4)
    expect(geo.longitude).toBeCloseTo(68.787, 4)
    expect(found.deliveryLandmark).toBe('near the bridge')
    expect(found.items).toHaveLength(1)
    expect(item.unitPrice.diram).toBe(100_00n)
    expect(item.commissionBps).toBe(800)
    expect(item.inventoryBatchId).toBe(inventoryBatchId)
  })

  it('findByCheckoutAttemptId() — находит по чекаут-попытке', async () => {
    const order = await createSavedOrder()

    const found = await repo.findByCheckoutAttemptId(tenantId, order.checkoutAttemptId)
    expect(found?.id).toBe(order.id)
  })

  it('SRS-API-046: findById()/findByCheckoutAttemptId() — заказ существует, но в ЧУЖОМ тенанте → null', async () => {
    const order = await createSavedOrder()
    const otherTenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [otherTenantId, `dtj227-other-${otherTenantId.slice(0, 8)}`])

    try {
      expect(await repo.findById(otherTenantId, order.id)).toBeNull()
      expect(await repo.findByCheckoutAttemptId(otherTenantId, order.checkoutAttemptId)).toBeNull()
    } finally {
      await pool.query('DELETE FROM tenants WHERE id = $1', [otherTenantId]).catch(() => undefined)
    }
  })

  it('save() — upsert: повторный save() после markPaidEscrow() персистит НОВОЕ состояние, не создаёт вторую строку', async () => {
    const created = Order.create(buildCommand({ paymentMethod: 'alif_mobi' }))
    if (!created.ok) throw new Error('fixture: expected Ok')
    const order = created.value
    createdOrderIds.push(order.id)
    await repo.save(order)
    expect(order.status).toBe('pending_payment')

    order.markPaidEscrow('txn-123', new Date('2026-09-02T13:00:00.000Z'), true)
    await repo.save(order)

    const rows = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM orders WHERE id = $1', [order.id])
    expect(rows.rows[0]?.n).toBe(1)
    const found = await repo.findById(tenantId, order.id)
    expect(found?.status).toBe('paid_escrow')
    expect(found?.toSnapshot().paymentTransactionId).toBe('txn-123')
  })

  it('findById() — несуществующий заказ → null', async () => {
    expect(await repo.findById(tenantId, randomUUID())).toBeNull()
  })

  it('DTJ-228 — save() → findById() персистирует и восстанавливает billingStrategy', async () => {
    const order = await createSavedOrder({ billingStrategy: 'single_invoice' })
    const found = await findOrThrow(order.id)
    expect(found.toSnapshot().billingStrategy).toBe('single_invoice')

    const row = await pool.query<{ billing_strategy: string }>('SELECT billing_strategy FROM orders WHERE id = $1', [order.id])
    expect(row.rows[0]?.billing_strategy).toBe('single_invoice')
  })
})
