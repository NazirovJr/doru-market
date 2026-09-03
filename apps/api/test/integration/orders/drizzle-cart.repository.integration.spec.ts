/**
 * Интеграционный тест `DrizzleCartRepository` (EP-09, DTJ-223) — РЕАЛЬНЫЙ Postgres, не
 * мок/фейк (урок волны 5 §6.4 `reports/EP09-CTO-BRIEF.md`). Два фокуса тест-плана тикета:
 *
 *   1. `upsertItem` — реальный `UNIQUE`-констрейнт срабатывает как ожидается (upsert, не
 *      ошибка конфликта наружу).
 *   2. Тенант-изоляция (SRS-API-043/046, доработка по замечанию CTO, обязательный тест) —
 *      две корзины в ДВУХ тенантах, доступ из чужого тенанта по `id` даёт `null`/`false`/`[]`
 *      и НЕ создаёт/не меняет/не удаляет ни одной строки в чужом тенанте (проверено SQL-
 *      счётчиком по `cart_items`, не только возвращённым значением метода — счётчик ловит
 *      баг, который вернул бы «правильный» ответ, но всё равно записал/удалил бы строку).
 *
 * Уборка (правило 5 AGENTS.md): `afterEach` удаляет ТОЛЬКО строки, созданные ЭТИМ тестом,
 * по их id (`tenant`/`pharmacy`/`medicine` каскадом тянут за собой `cart`/`cart_items` —
 * `ON DELETE CASCADE` в `0023_orders_cart.sql`), не `TRUNCATE`. `categories` — общая с
 * другими интеграционными сьютами (тот же приём, что `drizzle-pharmacy-sku-mapping.
 * repository.integration.spec.ts`) — переиспользуется через `ON CONFLICT`, не создаётся
 * заново и не удаляется.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { DrizzleCartRepository } from '@/modules/orders/infrastructure/repositories/cart.repository.js'

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

describe.skipIf(!postgresAvailable)('DrizzleCartRepository — integration (DTJ-223)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let repo: DrizzleCartRepository
  // Тенант A — «свой» для большинства тестов; тенант B — только для проверки изоляции.
  let tenantId: string
  let tenantIdB: string
  let pharmacyId: string
  let pharmacyId2: string
  let medicineId: string
  let cartId: string
  let cartIdB: string

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    repo = new DrizzleCartRepository(db)
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

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy DTJ-223', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000000')`,
      [id],
    )
    return id
  }

  async function seedTenant(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      id,
      `dtj223-${id.slice(0, 8)}`,
    ])
    return id
  }

  async function seedCart(forTenantId: string): Promise<string> {
    const cart = await pool.query<{ id: string }>(
      `INSERT INTO cart (id, tenant_id, session_token) VALUES (gen_random_uuid(), $1, 'guest-token') RETURNING id`,
      [forTenantId],
    )
    const id = cart.rows[0]?.id
    if (id === undefined) throw new Error('seedCart: no id returned')
    return id
  }

  async function countCartItems(forCartId: string): Promise<number> {
    const rows = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM cart_items WHERE cart_id = $1', [
      forCartId,
    ])
    return rows.rows[0]?.n ?? 0
  }

  /** D-EP09-13: бэкдейтит `cart.updated_at` на час назад — иначе `NOW()`-точность может дать
   *  ту же миллисекунду при создании и первой мутации в быстром прогоне теста. */
  async function backdateCartUpdatedAt(forCartId: string): Promise<Date> {
    const rows = await pool.query<{ updated_at: Date }>(
      `UPDATE cart SET updated_at = NOW() - INTERVAL '1 hour' WHERE id = $1 RETURNING updated_at`,
      [forCartId],
    )
    const updatedAt = rows.rows[0]?.updated_at
    if (updatedAt === undefined) throw new Error('backdateCartUpdatedAt: no row returned')
    return updatedAt
  }

  async function getCartUpdatedAt(forCartId: string): Promise<Date> {
    const rows = await pool.query<{ updated_at: Date }>('SELECT updated_at FROM cart WHERE id = $1', [forCartId])
    const updatedAt = rows.rows[0]?.updated_at
    if (updatedAt === undefined) throw new Error('getCartUpdatedAt: cart not found')
    return updatedAt
  }

  beforeEach(async () => {
    tenantId = await seedTenant()
    tenantIdB = await seedTenant()
    pharmacyId = await seedPharmacy()
    pharmacyId2 = await seedPharmacy()
    medicineId = await seedMedicine()
    cartId = await seedCart(tenantId)
    cartIdB = await seedCart(tenantIdB)
  })

  afterEach(async () => {
    // Каскад: tenant → cart → cart_items (ON DELETE CASCADE, 0023_orders_cart.sql).
    await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantId, tenantIdB]])
    await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [[pharmacyId, pharmacyId2]])
    await pool.query('DELETE FROM medicines WHERE id = $1', [medicineId])
  })

  it('findById — находит созданную корзину своего тенанта', async () => {
    const found = await repo.findById(tenantId, cartId)
    expect(found).toEqual({ id: cartId, tenantId, customerId: null, sessionToken: 'guest-token' })
  })

  it('findById — несуществующая корзина → null', async () => {
    expect(await repo.findById(tenantId, randomUUID())).toBeNull()
  })

  it('SRS-API-046: findById — корзина существует, но принадлежит ДРУГОМУ тенанту → null (не строит различие «нет доступа» vs «не существует»)', async () => {
    expect(await repo.findById(tenantIdB, cartId)).toBeNull()
  })

  it('upsertItem — первая вставка создаёт строку с quantity = quantityDelta', async () => {
    const item = await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 3 })
    expect(item?.quantity).toBe(3)
    expect(item?.cartId).toBe(cartId)
  })

  it('upsertItem — повторный вызов с тем же (cartId, medicineId, pharmacyId) СКЛАДЫВАЕТ quantity через реальный UNIQUE-констрейнт, не бросает ошибку конфликта', async () => {
    await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 2 })
    const second = await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 5 })

    expect(second?.quantity).toBe(7)
    const rows = await pool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM cart_items WHERE cart_id = $1 AND medicine_id = $2 AND pharmacy_id = $3',
      [cartId, medicineId, pharmacyId],
    )
    expect(rows.rows[0]?.n).toBe(1)
  })

  it('upsertItem — тот же medicineId на ДРУГОЙ аптеке создаёт ОТДЕЛЬНУЮ строку (UNIQUE включает pharmacy_id)', async () => {
    await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })
    await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId: pharmacyId2, quantityDelta: 1 })

    const items = await repo.findItemsByCartId(tenantId, cartId)
    expect(items).toHaveLength(2)
  })

  it('SRS-API-046: upsertItem с ЧУЖИМ tenantId → null, НИ ОДНОЙ новой строки в cart_items (SQL-счётчик, не только возврат)', async () => {
    const result = await repo.upsertItem(tenantIdB, { cartId, medicineId, pharmacyId, quantityDelta: 5 })

    expect(result).toBeNull()
    expect(await countCartItems(cartId)).toBe(0)
  })

  it('findItemsByCartId — возвращает только строки своей корзины', async () => {
    await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })
    const items = await repo.findItemsByCartId(tenantId, randomUUID())
    expect(items).toHaveLength(0)
  })

  it('SRS-API-046: findItemsByCartId с ЧУЖИМ tenantId → [] (не подтверждает существование чужой корзины/строк)', async () => {
    await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })
    expect(await repo.findItemsByCartId(tenantIdB, cartId)).toHaveLength(0)
  })

  it('updateItemQuantity — обновляет quantity в рамках своей корзины', async () => {
    const created = await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })
    if (created === null) throw new Error('setup: upsertItem returned null')
    const updated = await repo.updateItemQuantity({ tenantId, cartId, cartItemId: created.id, quantity: 9 })
    expect(updated?.quantity).toBe(9)
  })

  it('updateItemQuantity — чужая корзина (тот же тенант) не даёт обновить (владение), возвращает null', async () => {
    const created = await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })
    if (created === null) throw new Error('setup: upsertItem returned null')
    const updated = await repo.updateItemQuantity({
      tenantId,
      cartId: randomUUID(),
      cartItemId: created.id,
      quantity: 9,
    })
    expect(updated).toBeNull()
    const items = await repo.findItemsByCartId(tenantId, cartId)
    expect(items[0]?.quantity).toBe(1) // не изменилась
  })

  it('SRS-API-046: updateItemQuantity с ЧУЖИМ tenantId (верный cartId) → null, quantity НЕ изменена', async () => {
    const created = await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })
    if (created === null) throw new Error('setup: upsertItem returned null')
    const updated = await repo.updateItemQuantity({
      tenantId: tenantIdB,
      cartId,
      cartItemId: created.id,
      quantity: 999,
    })

    expect(updated).toBeNull()
    const rows = await pool.query<{ quantity: number }>('SELECT quantity FROM cart_items WHERE id = $1', [
      created.id,
    ])
    expect(rows.rows[0]?.quantity).toBe(1)
  })

  it('deleteItem — удаляет строку своей корзины, возвращает true', async () => {
    const created = await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })
    if (created === null) throw new Error('setup: upsertItem returned null')
    const deleted = await repo.deleteItem(tenantId, cartId, created.id)
    expect(deleted).toBe(true)
    expect(await repo.findItemsByCartId(tenantId, cartId)).toHaveLength(0)
  })

  it('deleteItem — чужая корзина (тот же тенант) не даёт удалить, возвращает false', async () => {
    const created = await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })
    if (created === null) throw new Error('setup: upsertItem returned null')
    const deleted = await repo.deleteItem(tenantId, randomUUID(), created.id)
    expect(deleted).toBe(false)
    expect(await repo.findItemsByCartId(tenantId, cartId)).toHaveLength(1)
  })

  it('SRS-API-046: deleteItem с ЧУЖИМ tenantId (верный cartId) → false, строка НЕ удалена (SQL-счётчик)', async () => {
    const created = await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })
    if (created === null) throw new Error('setup: upsertItem returned null')
    const deleted = await repo.deleteItem(tenantIdB, cartId, created.id)

    expect(deleted).toBe(false)
    expect(await countCartItems(cartId)).toBe(1)
  })

  it('SRS-API-046: изоляция сквозная — тенант B заводит СВОЮ позицию в СВОЕЙ корзине, тенант A её не видит', async () => {
    await repo.upsertItem(tenantIdB, { cartId: cartIdB, medicineId, pharmacyId, quantityDelta: 4 })

    expect(await repo.findItemsByCartId(tenantId, cartIdB)).toHaveLength(0)
    expect(await repo.findItemsByCartId(tenantIdB, cartIdB)).toHaveLength(1)
  })

  describe('D-EP09-13: cart.updated_at бампается мутациями cart_items (защита джобы очистки от тихой потери активных корзин)', () => {
    it('upsertItem — добавление позиции обновляет cart.updated_at родительской корзины', async () => {
      const before = await backdateCartUpdatedAt(cartId)

      await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })

      const after = await getCartUpdatedAt(cartId)
      expect(after.getTime()).toBeGreaterThan(before.getTime())
    })

    it('updateItemQuantity — изменение количества обновляет cart.updated_at', async () => {
      const created = await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })
      if (created === null) throw new Error('setup: upsertItem returned null')
      const before = await backdateCartUpdatedAt(cartId)

      await repo.updateItemQuantity({ tenantId, cartId, cartItemId: created.id, quantity: 5 })

      const after = await getCartUpdatedAt(cartId)
      expect(after.getTime()).toBeGreaterThan(before.getTime())
    })

    it('deleteItem — удаление позиции обновляет cart.updated_at', async () => {
      const created = await repo.upsertItem(tenantId, { cartId, medicineId, pharmacyId, quantityDelta: 1 })
      if (created === null) throw new Error('setup: upsertItem returned null')
      const before = await backdateCartUpdatedAt(cartId)

      await repo.deleteItem(tenantId, cartId, created.id)

      const after = await getCartUpdatedAt(cartId)
      expect(after.getTime()).toBeGreaterThan(before.getTime())
    })

    it('SRS-API-046: upsertItem с ЧУЖИМ tenantId НЕ бампает cart.updated_at (тенант-фильтр применяется и к бампу)', async () => {
      const before = await backdateCartUpdatedAt(cartId)

      await repo.upsertItem(tenantIdB, { cartId, medicineId, pharmacyId, quantityDelta: 1 })

      const after = await getCartUpdatedAt(cartId)
      expect(after.getTime()).toBe(before.getTime())
    })
  })
})
