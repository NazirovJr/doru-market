/**
 * Интеграционный тест `InventoryFacadeAdapter` (EP-09, DTJ-227) — РЕАЛЬНЫЙ Postgres.
 *
 * Три фокуса тест-плана DoD:
 *   1. `reserveStock` — FEFO (самый ранний `expires_at`, лот целиком покрывает `quantity`),
 *      `INSUFFICIENT_STOCK`, недостающий у ЕДИНСТВЕННОГО подходящего лота остаток.
 *   2. `releaseStock`/`hasExpiredReservedBatch`/`getStockQuantity` — прямые ассерты по строкам БД.
 *   3. **Транзакционная атомарность (D-EP09-21, DoD DTJ-227) — САМОЕ ВАЖНОЕ:** `reserveStock`,
 *      вызванный ВНУТРИ `db.transaction()`, которая затем ОТКАТЫВАЕТСЯ (симулирует провал ОДНОЙ
 *      группы checkout ПОСЛЕ резерва, например `Order.create()` бросил), обязан оставить
 *      `quantity` НЕТРОНУТЫМ — резерв ЧАСТЬ той же транзакции, что и создание заказа, а не
 *      отдельное соединение пула. Второй кейс — соседняя транзакция (другая «группа») коммитится
 *      независимо и её резерв остаётся в силе, доказывая изоляцию транзакций.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { ErrorCode } from '@dorutj/contracts'
import { InventoryFacadeAdapter } from '@/modules/orders/infrastructure/adapters/inventory-facade.adapter.js'

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

describe.skipIf(!postgresAvailable)('InventoryFacadeAdapter — integration (DTJ-227, D-EP09-21)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let adapter: InventoryFacadeAdapter
  let tenantId: string
  let pharmacyId: string
  let customerId: string
  let medicineId: string
  let createdOrderIds: string[]
  let createdBatchIds: string[]

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    adapter = new InventoryFacadeAdapter(db)
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
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [id, `dtj227inv-${id.slice(0, 8)}`])
    return id
  }

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy DTJ-227-inv', 'Dushanbe, test str. 2', 38.5598, 68.7870, '+992900000003')`,
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

  async function seedBatch(expiresInDays: number, quantity: number, price = 1000): Promise<string> {
    const batch = await pool.query<{ id: string }>(
      `INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, CURRENT_DATE + $5 * INTERVAL '1 day', $6)
       RETURNING id`,
      [pharmacyId, medicineId, price, quantity, expiresInDays, `BATCH-${randomUUID().slice(0, 8)}`],
    )
    const id = batch.rows[0]?.id
    if (id === undefined) throw new Error('seedBatch: no id returned')
    createdBatchIds.push(id)
    return id
  }

  let orderNumberSeq = 0
  async function seedOrderReferencingBatch(batchId: string): Promise<string> {
    orderNumberSeq += 1
    const orderId = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'confirmed', 'cash_courier', 20.00, 0.00, 20.00, 'Dushanbe, Rudaki 1', $5, $6)`,
      [orderId, `DTJ-260902-${String(orderNumberSeq).padStart(5, '0')}`, customerId, pharmacyId, tenantId, randomUUID()],
    )
    await pool.query(
      `INSERT INTO order_items (id, order_id, medicine_id, unit_price_tjs, quantity, total_price_tjs, commission_bps, platform_fee_diram, inventory_batch_id)
       VALUES (gen_random_uuid(), $1, $2, 10.00, 2, 20.00, 0, 0, $3)`,
      [orderId, medicineId, batchId],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  beforeEach(async () => {
    createdOrderIds = []
    createdBatchIds = []
    tenantId = await seedTenant()
    pharmacyId = await seedPharmacy()
    customerId = await seedCustomer(tenantId)
    medicineId = await seedMedicine()
  })

  afterEach(async () => {
    await pool.query('DELETE FROM order_items WHERE order_id = ANY($1)', [createdOrderIds]).catch(() => undefined)
    await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacy_inventory WHERE id = ANY($1)', [createdBatchIds]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM medicines WHERE id = $1', [medicineId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [customerId]).catch(() => undefined)
  })

  it('reserveStock — FEFO: два лота, ранний по expires_at выбран целиком, decrement применён', async () => {
    const earlyBatch = await seedBatch(10, 20, 1_000)
    await seedBatch(365, 20, 1_500) // позже истекает — НЕ должен быть выбран

    const result = await adapter.reserveStock(pharmacyId, [{ medicineId, quantity: 5 }])

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.value).toEqual([{ medicineId, inventoryBatchId: earlyBatch, quantity: 5, unitPriceDiram: 1_000n }])
    const row = await pool.query<{ quantity: number }>('SELECT quantity FROM pharmacy_inventory WHERE id = $1', [earlyBatch])
    expect(row.rows[0]?.quantity).toBe(15)
  })

  it('reserveStock — ни один ОДИН лот не покрывает запрошенное количество целиком → INSUFFICIENT_STOCK (даже если сумма лотов достаточна)', async () => {
    await seedBatch(10, 3)
    await seedBatch(20, 3)

    const result = await adapter.reserveStock(pharmacyId, [{ medicineId, quantity: 5 }])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected err')
    expect(result.error).toEqual({ code: ErrorCode.INSUFFICIENT_STOCK, medicineId })
  })

  it('reserveStock — просроченный лот (expires_at в прошлом) игнорируется', async () => {
    await pool.query(
      `INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
       VALUES (gen_random_uuid(), $1, $2, 1000, 100, CURRENT_DATE - INTERVAL '1 day', 'EXPIRED') RETURNING id`,
      [pharmacyId, medicineId],
    ).then((r) => createdBatchIds.push((r.rows[0] as { id: string }).id))

    const result = await adapter.reserveStock(pharmacyId, [{ medicineId, quantity: 1 }])
    expect(result.ok).toBe(false)
  })

  it('releaseStock — возвращает количество на лот', async () => {
    const batchId = await seedBatch(10, 20)
    await adapter.reserveStock(pharmacyId, [{ medicineId, quantity: 5 }])

    await adapter.releaseStock([{ inventoryBatchId: batchId, quantity: 5 }])

    const row = await pool.query<{ quantity: number }>('SELECT quantity FROM pharmacy_inventory WHERE id = $1', [batchId])
    expect(row.rows[0]?.quantity).toBe(20)
  })

  it('hasExpiredReservedBatch — true для заказа, чей резервированный лот с тех пор истёк', async () => {
    const batchId = await seedBatch(-1, 10) // истёк уже на момент вставки строки заказа
    const orderId = await seedOrderReferencingBatch(batchId)

    expect(await adapter.hasExpiredReservedBatch(orderId)).toBe(true)
  })

  it('hasExpiredReservedBatch — false для непросроченного лота', async () => {
    const batchId = await seedBatch(30, 10)
    const orderId = await seedOrderReferencingBatch(batchId)

    expect(await adapter.hasExpiredReservedBatch(orderId)).toBe(false)
  })

  it('getStockQuantity — сумма непросроченных лотов, просроченные не учитываются', async () => {
    await seedBatch(10, 7)
    await seedBatch(20, 3)
    await pool
      .query(
        `INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
         VALUES (gen_random_uuid(), $1, $2, 1000, 999, CURRENT_DATE - INTERVAL '1 day', 'EXPIRED2') RETURNING id`,
        [pharmacyId, medicineId],
      )
      .then((r) => createdBatchIds.push((r.rows[0] as { id: string }).id))

    expect(await adapter.getStockQuantity(pharmacyId, medicineId)).toBe(10)
  })

  it('D-EP09-21 — reserveStock ВНУТРИ транзакции, которая ОТКАТЫВАЕТСЯ, оставляет quantity нетронутым (атомарность резерва группы)', async () => {
    const batchId = await seedBatch(10, 20)

    await db
      .transaction(async (tx) => {
        await adapter.reserveStock(pharmacyId, [{ medicineId, quantity: 5 }], tx)
        throw new Error('simulated Order.create() failure inside the group transaction')
      })
      .catch(() => undefined)

    const row = await pool.query<{ quantity: number }>('SELECT quantity FROM pharmacy_inventory WHERE id = $1', [batchId])
    expect(row.rows[0]?.quantity).toBe(20) // откачен, не 15
  })

  it('D-EP09-21 — соседняя (другая) транзакция коммитится независимо от отката первой (изоляция групп checkout)', async () => {
    // Одна и та же строка лота — намеренно: показывает, что откат ГРУППЫ А (первая транзакция)
    // не оставляет никакого следа, который помешал бы ГРУППЕ Б (вторая, независимая транзакция)
    // увидеть исходное количество и закоммитить СВОЙ резерв поверх него — ровно то, что делает
    // `CheckoutUseCase.processGroup` для двух групп одного checkout (SRS-ORD-019).
    const batchId = await seedBatch(10, 20)

    await db
      .transaction(async (tx) => {
        await adapter.reserveStock(pharmacyId, [{ medicineId, quantity: 5 }], tx)
        throw new Error('group A fails')
      })
      .catch(() => undefined)
    await db.transaction(async (tx) => {
      await adapter.reserveStock(pharmacyId, [{ medicineId, quantity: 5 }], tx)
    })

    const row = await pool.query<{ quantity: number }>('SELECT quantity FROM pharmacy_inventory WHERE id = $1', [batchId])
    // 20 (исходно) − 0 (группа А откачена) − 5 (группа Б закоммичена) = 15, НЕ 10 —
    // откат группы А не помешал и не задвоился с группой Б.
    expect(row.rows[0]?.quantity).toBe(15)
  })
})
