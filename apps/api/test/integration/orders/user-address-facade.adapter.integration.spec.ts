/**
 * Интеграционный тест `UserAddressFacadeAdapter` (EP-09, DTJ-229) — РЕАЛЬНЫЙ Postgres, не
 * мок/фейк (урок волны 5 §6.4). Фокус: `getById` — тенант-независимый (`user_addresses` не
 * несёт `tenant_id`) owner-скоуп через `customerId` (SRS-API-046 — чужой адрес → `null`, не
 * `403`), координаты `null` (легитимно, `latitude`/`longitude` — nullable колонки DTJ-014).
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import { UserAddressFacadeAdapter } from '@/modules/orders/infrastructure/adapters/user-address-facade.adapter.js'

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

describe.skipIf(!postgresAvailable)('UserAddressFacadeAdapter — integration (DTJ-229)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let adapter: UserAddressFacadeAdapter
  let tenantId: string
  let customerId: string
  let otherCustomerId: string
  let createdAddressIds: string[]

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    adapter = new UserAddressFacadeAdapter(db)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    await pool.query('DELETE FROM user_addresses WHERE id = ANY($1)', [createdAddressIds]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[customerId, otherCustomerId]]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
  })

  async function seed(): Promise<void> {
    createdAddressIds = []
    tenantId = randomUUID()
    customerId = randomUUID()
    otherCustomerId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj229-${tenantId.slice(0, 8)}`])
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer'), ($3, $2, 'customer')`, [
      customerId,
      tenantId,
      otherCustomerId,
    ])
  }

  async function seedAddress(userId: string, overrides: { latitude?: number | null; longitude?: number | null; landmarkText?: string | null } = {}): Promise<string> {
    const id = randomUUID()
    const lat = overrides.latitude === undefined ? 38.5598 : overrides.latitude
    const lon = overrides.longitude === undefined ? 68.787 : overrides.longitude
    await pool.query(
      `INSERT INTO user_addresses (id, user_id, address_text, landmark_text, latitude, longitude, is_default)
       VALUES ($1, $2, 'Dushanbe, Rudaki 1', $3, $4, $5, false)`,
      [id, userId, overrides.landmarkText ?? 'near the bridge', lat, lon],
    )
    createdAddressIds.push(id)
    return id
  }

  it('getById — существующий адрес своего customer → снимок с GeoPoint', async () => {
    await seed()
    const addressId = await seedAddress(customerId)

    const found = await adapter.getById(addressId, customerId)

    expect(found?.addressText).toBe('Dushanbe, Rudaki 1')
    expect(found?.landmarkText).toBe('near the bridge')
    expect(found?.geoPoint?.latitude).toBeCloseTo(38.5598, 4)
    expect(found?.geoPoint?.longitude).toBeCloseTo(68.787, 4)
  })

  it('SRS-API-046 — адрес принадлежит ДРУГОМУ customer → null (не бросает, не 403)', async () => {
    await seed()
    const addressId = await seedAddress(customerId)

    const found = await adapter.getById(addressId, otherCustomerId)
    expect(found).toBeNull()
  })

  it('несуществующий addressId → null', async () => {
    await seed()
    const found = await adapter.getById(randomUUID(), customerId)
    expect(found).toBeNull()
  })

  it('latitude/longitude отсутствуют (nullable, DTJ-014) → geoPoint: null (легитимно, не ошибка)', async () => {
    await seed()
    const addressId = await seedAddress(customerId, { latitude: null, longitude: null })

    const found = await adapter.getById(addressId, customerId)
    expect(found).not.toBeNull()
    expect(found?.geoPoint).toBeNull()
  })
})
