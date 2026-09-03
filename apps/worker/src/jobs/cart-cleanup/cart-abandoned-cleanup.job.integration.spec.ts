/**
 * Интеграционный тест `CartAbandonedCleanupJob` (DTJ-224) — РЕАЛЬНЫЙ Postgres, не мок
 * (тест-план тикета: «удаляет старые, не трогает свежие корзины»; D-EP09-14
 * `reports/EP09-CTO-BRIEF.md`: Testcontainers не используются — живой локальный Postgres +
 * `describe.skipIf`, тот же приём, что `apps/api/test/integration/orders/
 * drizzle-cart.repository.integration.spec.ts`).
 *
 * Критерий приёмки №5 DTJ-224: корзина без активности 31 день → корзина И её `cart_items`
 * удалены (каскад `ON DELETE CASCADE`, проверяется явно — не полагаемся на веру в схему).
 * Дополнительно — свежая корзина (1 день) НЕ удаляется, гостевая корзина использует СВОЙ
 * (короче) горизонт хранения.
 *
 * Уборка (правило 5 AGENTS.md): `afterEach` удаляет ТОЛЬКО строки, созданные ЭТИМ тестом.
 * `categories` — общая с другими интеграционными сьютами (тот же приём, что
 * `drizzle-cart.repository.integration.spec.ts`), переиспользуется через `ON CONFLICT`.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { CartAbandonedCleanupJob } from './cart-abandoned-cleanup.job.js'
import { PgCartCleanupRetentionAdapter } from './pg-cart-cleanup-retention.adapter.js'

const TEST_DATABASE_URL =
  process.env.ORDERS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500
const REGISTERED_TTL_DAYS = 30
const GUEST_TTL_DAYS = 7

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

describe.skipIf(!postgresAvailable)('CartAbandonedCleanupJob — integration (DTJ-224)', () => {
  let pool: Pool
  let job: CartAbandonedCleanupJob
  let tenantIds: string[]
  let pharmacyIds: string[]
  let medicineIds: string[]

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    job = new CartAbandonedCleanupJob(new PgCartCleanupRetentionAdapter(pool), REGISTERED_TTL_DAYS, GUEST_TTL_DAYS)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  beforeEach(() => {
    tenantIds = []
    pharmacyIds = []
    medicineIds = []
  })

  afterEach(async () => {
    // Каскад: tenant → users/cart → cart_items (ON DELETE CASCADE, 0023_orders_cart.sql).
    if (tenantIds.length > 0) await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [tenantIds])
    if (pharmacyIds.length > 0) await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [pharmacyIds])
    if (medicineIds.length > 0) await pool.query('DELETE FROM medicines WHERE id = ANY($1)', [medicineIds])
  })

  async function seedTenantAndUser(): Promise<{ tenantId: string; userId: string }> {
    const tenantId = randomUUID()
    const userId = randomUUID()
    tenantIds.push(tenantId)
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      tenantId,
      `dtj224-${tenantId.slice(0, 8)}`,
    ])
    await pool.query(`INSERT INTO users (id, tenant_id) VALUES ($1, $2)`, [userId, tenantId])
    return { tenantId, userId }
  }

  async function resolveRootCategoryId(): Promise<number> {
    const category = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('dtj224-root', 'Корень', 'Root', 'Root', 'otc', 0, true)
       ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
       RETURNING id`,
    )
    const id = category.rows[0]?.id
    if (id === undefined) throw new Error('resolveRootCategoryId: no id returned')
    return id
  }

  async function seedCart(options: {
    tenantId: string
    customerId: string | null
    ageDays: number
  }): Promise<{ cartId: string; itemId: string }> {
    const cartId = randomUUID()
    await pool.query(
      `INSERT INTO cart (id, tenant_id, customer_id, session_token, updated_at)
       VALUES ($1, $2, $3, $4, NOW() - ($5 || ' days')::interval)`,
      [
        cartId,
        options.tenantId,
        options.customerId,
        options.customerId === null ? 'guest-token' : null,
        options.ageDays,
      ],
    )

    const categoryId = await resolveRootCategoryId()
    const medicineId = randomUUID()
    const pharmacyId = randomUUID()
    medicineIds.push(medicineId)
    pharmacyIds.push(pharmacyId)
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, true)`,
      [medicineId, `Trade-${medicineId}`, `INN-${medicineId}`, categoryId],
    )
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy DTJ-224', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000001')`,
      [pharmacyId],
    )
    const itemId = randomUUID()
    await pool.query(
      `INSERT INTO cart_items (id, cart_id, medicine_id, pharmacy_id, quantity) VALUES ($1, $2, $3, $4, 1)`,
      [itemId, cartId, medicineId, pharmacyId],
    )
    return { cartId, itemId }
  }

  async function cartExists(cartId: string): Promise<boolean> {
    const rows = await pool.query('SELECT 1 FROM cart WHERE id = $1', [cartId])
    return (rows.rowCount ?? 0) > 0
  }

  async function cartItemExists(itemId: string): Promise<boolean> {
    const rows = await pool.query('SELECT 1 FROM cart_items WHERE id = $1', [itemId])
    return (rows.rowCount ?? 0) > 0
  }

  it('AC5: зарегистрированная корзина без активности 31 день — удалена корзина И её cart_items (каскад)', async () => {
    const { tenantId, userId } = await seedTenantAndUser()
    const { cartId, itemId } = await seedCart({ tenantId, customerId: userId, ageDays: 31 })

    await job.runOnce()

    expect(await cartExists(cartId)).toBe(false)
    expect(await cartItemExists(itemId)).toBe(false)
  })

  it('свежая зарегистрированная корзина (1 день) НЕ удаляется', async () => {
    const { tenantId, userId } = await seedTenantAndUser()
    const { cartId } = await seedCart({ tenantId, customerId: userId, ageDays: 1 })

    await job.runOnce()

    expect(await cartExists(cartId)).toBe(true)
  })

  it('гостевая корзина использует СВОЙ (короче) горизонт: 8 дней без активности — удалена, хотя < 30-дневного порога зарегистрированных', async () => {
    const { tenantId } = await seedTenantAndUser()
    const { cartId } = await seedCart({ tenantId, customerId: null, ageDays: 8 })

    await job.runOnce()

    expect(await cartExists(cartId)).toBe(false)
  })

  it('свежая гостевая корзина (1 день) НЕ удаляется', async () => {
    const { tenantId } = await seedTenantAndUser()
    const { cartId } = await seedCart({ tenantId, customerId: null, ageDays: 1 })

    await job.runOnce()

    expect(await cartExists(cartId)).toBe(true)
  })
})
