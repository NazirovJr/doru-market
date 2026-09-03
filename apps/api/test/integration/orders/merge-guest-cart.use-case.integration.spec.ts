/**
 * Интеграционный тест `MergeGuestCartUseCase` (EP-09, DTJ-226, SRS-ORD-020) — РЕАЛЬНЫЙ
 * Postgres, критерии приёмки №1/№2 тикета:
 *
 *   1. Гость добавил 2 позиции по session_token → OTP-логин → merge → обе позиции доступны в
 *      корзине customerId, гостевая строка cart удалена.
 *   2. У пользователя уже есть 1 позиция, гостевая корзина содержит ТУ ЖЕ (medicineId,
 *      pharmacyId) с другим количеством → merge → итоговое количество — СУММА (реальный
 *      UNIQUE-констрейнт `unique_cart_medicine_pharmacy`, не мок).
 *   + граничный случай: гостевой корзины с этим session_token не существует — no-op.
 *
 * Уборка (правило 5 AGENTS.md): `afterEach` удаляет по id созданных tenant/pharmacy/medicine
 * (`ON DELETE CASCADE` тянет `cart`/`cart_items`), не `TRUNCATE`.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import { DrizzleCartRepository } from '@/modules/orders/infrastructure/repositories/cart.repository.js'
import { DrizzleCartIdentityRepository } from '@/modules/orders/infrastructure/repositories/drizzle-cart-identity.repository.js'
import { MergeGuestCartUseCase } from '@/modules/orders/application/cart/merge-guest-cart.use-case.js'

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

describe.skipIf(!postgresAvailable)('MergeGuestCartUseCase — integration (DTJ-226)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let useCase: MergeGuestCartUseCase
  let identityRepo: DrizzleCartIdentityRepository
  let tenantId: string
  let pharmacyId: string
  let medicineIdA: string
  let medicineIdB: string

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    const cartRepo = new DrizzleCartRepository(db)
    identityRepo = new DrizzleCartIdentityRepository(db)
    useCase = new MergeGuestCartUseCase(cartRepo, identityRepo)
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
      [id, `Trade-DTJ226-${id}`, `INN-DTJ226-${id}`, categoryId],
    )
    return id
  }

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy DTJ-226', 'Dushanbe, test str. 2', 38.5598, 68.7870, '+992900000001')`,
      [id],
    )
    return id
  }

  /** `cart.customer_id` несёт FK на `users(id)` — customerId в merge-сценариях обязан быть
   *  РЕАЛЬНОЙ строкой users, иначе rebindToCustomer/findOrCreateByCustomerId падают 23503. */
  async function seedCustomer(forTenantId: string): Promise<string> {
    const id = randomUUID()
    const phoneSuffix = Math.floor(100_000_000 + Math.random() * 899_999_999)
    await pool.query(
      `INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, 'customer', true)`,
      [id, forTenantId, `+992${String(phoneSuffix)}`],
    )
    return id
  }

  async function seedTenant(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      id,
      `dtj226-${id.slice(0, 8)}`,
    ])
    return id
  }

  beforeAll(async () => {
    tenantId = await seedTenant()
    pharmacyId = await seedPharmacy()
    medicineIdA = await seedMedicine()
    medicineIdB = await seedMedicine()
  })

  afterEach(async () => {
    await pool.query('DELETE FROM cart WHERE tenant_id = $1', [tenantId])
    await pool.query('DELETE FROM users WHERE tenant_id = $1', [tenantId])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId])
    await pool.query('DELETE FROM medicines WHERE id = ANY($1)', [[medicineIdA, medicineIdB]])
  })

  it('граничный случай: гостевой корзины с этим session_token нет — no-op, не бросает', async () => {
    const customerId = await seedCustomer(tenantId)
    const result = await useCase.execute(tenantId, `no-such-token-${randomUUID()}`, customerId)
    expect(result).toEqual({ merged: false, cartId: null })
  })

  it('критерий №1: гость добавил 2 позиции → OTP-логин → merge → обе позиции доступны у customerId, гостевая cart удалена', async () => {
    const sessionToken = `guest-${randomUUID()}`
    const customerId = await seedCustomer(tenantId)
    const guestCart = await identityRepo.findOrCreateBySessionToken(tenantId, sessionToken)
    const cartRepo = new DrizzleCartRepository(db)
    await cartRepo.upsertItem(tenantId, {
      cartId: guestCart.id,
      medicineId: medicineIdA,
      pharmacyId,
      quantityDelta: 2,
    })
    await cartRepo.upsertItem(tenantId, {
      cartId: guestCart.id,
      medicineId: medicineIdB,
      pharmacyId,
      quantityDelta: 1,
    })

    const result = await useCase.execute(tenantId, sessionToken, customerId)

    expect(result.merged).toBe(true)
    expect(result.cartId).toBe(guestCart.id) // rebind — тот же id корзины, без построчного переноса
    const items = await cartRepo.findItemsByCartId(tenantId, guestCart.id)
    expect(items).toHaveLength(2)
    const customerCart = await identityRepo.findByCustomerId(tenantId, customerId)
    expect(customerCart?.id).toBe(guestCart.id)
    expect(customerCart?.sessionToken).toBeNull()
    expect(await identityRepo.findBySessionToken(tenantId, sessionToken)).toBeNull()
  })

  it('критерий №2: у клиента уже есть 1 позиция, гостевая корзина содержит ТУ ЖЕ пару (medicineId, pharmacyId) с другим количеством → итог СУММА, не дубликат строки, гостевая cart удалена', async () => {
    const sessionToken = `guest-${randomUUID()}`
    const customerId = await seedCustomer(tenantId)
    const cartRepo = new DrizzleCartRepository(db)

    const customerCart = await identityRepo.findOrCreateByCustomerId(tenantId, customerId)
    await cartRepo.upsertItem(tenantId, {
      cartId: customerCart.id,
      medicineId: medicineIdA,
      pharmacyId,
      quantityDelta: 5,
    })
    const guestCart = await identityRepo.findOrCreateBySessionToken(tenantId, sessionToken)
    await cartRepo.upsertItem(tenantId, {
      cartId: guestCart.id,
      medicineId: medicineIdA,
      pharmacyId,
      quantityDelta: 3,
    })

    const result = await useCase.execute(tenantId, sessionToken, customerId)

    expect(result).toEqual({ merged: true, cartId: customerCart.id })
    const items = await cartRepo.findItemsByCartId(tenantId, customerCart.id)
    expect(items).toHaveLength(1) // не дублирующая строка
    expect(items[0]?.quantity).toBe(8) // 5 + 3, СУММА через реальный UNIQUE-констрейнт
    // Гостевая cart удалена — не остаётся сиротой.
    expect(await identityRepo.findBySessionToken(tenantId, sessionToken)).toBeNull()
  })
})
