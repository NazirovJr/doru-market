/**
 * Интеграционный тест `DrizzleCartIdentityRepository` (EP-09, DTJ-226) — РЕАЛЬНЫЙ Postgres,
 * не мок/фейк (урок волны 5 §6.4 `reports/EP09-CTO-BRIEF.md`). Фокус тест-плана:
 *
 *   1. D-EP09-22 — идемпотентное `findOrCreate*` под РЕАЛЬНОЙ гонкой (`Promise.all` двух
 *      параллельных вызовов с ОДНИМ `customerId`/`sessionToken` против настоящего Postgres) —
 *      это именно то, что unit-тест на in-memory фикстуре доказать не может (там нет
 *      конкурентных транзакций).
 *   2. Тенант-изоляция (SRS-API-043/046) — чужой тенант не резолвит/не создаёт поверх чужой
 *      строки.
 *
 * Уборка (правило 5 AGENTS.md): `afterEach` удаляет ТОЛЬКО строки, созданные ЭТИМ тестом, по
 * id тенантов (`ON DELETE CASCADE` тянет за собой `cart`), не `TRUNCATE`.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import { DrizzleCartIdentityRepository } from '@/modules/orders/infrastructure/repositories/drizzle-cart-identity.repository.js'

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

describe.skipIf(!postgresAvailable)('DrizzleCartIdentityRepository — integration (DTJ-226)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let repo: DrizzleCartIdentityRepository
  const createdTenantIds: string[] = []

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    repo = new DrizzleCartIdentityRepository(db)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  async function seedTenant(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      id,
      `dtj226-${id.slice(0, 8)}`,
    ])
    createdTenantIds.push(id)
    return id
  }

  /** `cart.customer_id` несёт FK на `users(id)` — customerId в этих тестах обязан быть
   *  РЕАЛЬНОЙ строкой (`ON DELETE CASCADE` тенанта тянет за собой и её). */
  async function seedUser(forTenantId: string): Promise<string> {
    const id = randomUUID()
    const phoneSuffix = Math.floor(100_000_000 + Math.random() * 899_999_999)
    await pool.query(
      `INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, 'customer', true)`,
      [id, forTenantId, `+992${String(phoneSuffix)}`],
    )
    return id
  }

  async function countCarts(forTenantId: string): Promise<number> {
    const rows = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM cart WHERE tenant_id = $1', [
      forTenantId,
    ])
    return rows.rows[0]?.n ?? 0
  }

  afterEach(async () => {
    if (createdTenantIds.length > 0) {
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [createdTenantIds])
      createdTenantIds.length = 0
    }
  })

  it('findOrCreateByCustomerId — первый вызов создаёт строку', async () => {
    const tenantId = await seedTenant()
    const customerId = await seedUser(tenantId)

    const cart = await repo.findOrCreateByCustomerId(tenantId, customerId)

    expect(cart.tenantId).toBe(tenantId)
    expect(cart.customerId).toBe(customerId)
    expect(cart.sessionToken).toBeNull()
    expect(await countCarts(tenantId)).toBe(1)
  })

  it('findOrCreateByCustomerId — повторный вызов возвращает ТУ ЖЕ строку, не создаёт вторую', async () => {
    const tenantId = await seedTenant()
    const customerId = await seedUser(tenantId)

    const first = await repo.findOrCreateByCustomerId(tenantId, customerId)
    const second = await repo.findOrCreateByCustomerId(tenantId, customerId)

    expect(second.id).toBe(first.id)
    expect(await countCarts(tenantId)).toBe(1)
  })

  it('D-EP09-22: ДВА ОДНОВРЕМЕННЫХ вызова с одним customerId дают РОВНО ОДНУ строку cart (реальная гонка, advisory lock)', async () => {
    const tenantId = await seedTenant()
    const customerId = await seedUser(tenantId)

    const [a, b] = await Promise.all([
      repo.findOrCreateByCustomerId(tenantId, customerId),
      repo.findOrCreateByCustomerId(tenantId, customerId),
    ])

    expect(a.id).toBe(b.id)
    expect(await countCarts(tenantId)).toBe(1)
  })

  it('D-EP09-22: ДВА ОДНОВРЕМЕННЫХ вызова с одним sessionToken дают РОВНО ОДНУ строку cart', async () => {
    const tenantId = await seedTenant()
    const sessionToken = `race-token-${randomUUID()}`

    const results = await Promise.all(
      Array.from({ length: 5 }, () => repo.findOrCreateBySessionToken(tenantId, sessionToken)),
    )

    const distinctIds = new Set(results.map((r) => r.id))
    expect(distinctIds.size).toBe(1)
    expect(await countCarts(tenantId)).toBe(1)
  })

  it('findByCustomerId/findBySessionToken — не создают строку, только читают', async () => {
    const tenantId = await seedTenant()

    expect(await repo.findByCustomerId(tenantId, randomUUID())).toBeNull()
    expect(await repo.findBySessionToken(tenantId, 'no-such-token')).toBeNull()
    expect(await countCarts(tenantId)).toBe(0)
  })

  it('SRS-API-046: findOrCreateByCustomerId в тенанте A НЕ резолвит/не путает с той же customerId в тенанте B', async () => {
    const tenantA = await seedTenant()
    const tenantB = await seedTenant()
    const customerId = await seedUser(tenantA)

    const cartA = await repo.findOrCreateByCustomerId(tenantA, customerId)
    const cartB = await repo.findOrCreateByCustomerId(tenantB, customerId)

    expect(cartA.id).not.toBe(cartB.id)
    expect(await countCarts(tenantA)).toBe(1)
    expect(await countCarts(tenantB)).toBe(1)
  })

  it('rebindToCustomer — перепривязывает гостевую корзину, session_token обнуляется', async () => {
    const tenantId = await seedTenant()
    const customerId = await seedUser(tenantId)
    const guestCart = await repo.findOrCreateBySessionToken(tenantId, `tok-${randomUUID()}`)

    const rebound = await repo.rebindToCustomer(tenantId, guestCart.id, customerId)

    expect(rebound?.id).toBe(guestCart.id)
    expect(rebound?.customerId).toBe(customerId)
    expect(rebound?.sessionToken).toBeNull()
  })

  it('SRS-API-046: rebindToCustomer с ЧУЖИМ tenantId → null, строка не изменена', async () => {
    const tenantA = await seedTenant()
    const tenantB = await seedTenant()
    const guestCart = await repo.findOrCreateBySessionToken(tenantA, `tok-${randomUUID()}`)

    const result = await repo.rebindToCustomer(tenantB, guestCart.id, randomUUID())

    expect(result).toBeNull()
    expect(await repo.findBySessionToken(tenantA, guestCart.sessionToken ?? '')).not.toBeNull()
  })

  it('deleteCart — удаляет строку своего тенанта, возвращает true; чужого — false и НЕ удаляет', async () => {
    const tenantA = await seedTenant()
    const tenantB = await seedTenant()
    const cart = await repo.findOrCreateBySessionToken(tenantA, `tok-${randomUUID()}`)

    expect(await repo.deleteCart(tenantB, cart.id)).toBe(false)
    expect(await countCarts(tenantA)).toBe(1)

    expect(await repo.deleteCart(tenantA, cart.id)).toBe(true)
    expect(await countCarts(tenantA)).toBe(0)
  })
})
