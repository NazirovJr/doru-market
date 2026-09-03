/**
 * Интеграционный тест `DrizzleIdempotencyKeysRepository` (EP-09, DTJ-227, D-EP09-18) —
 * РЕАЛЬНЫЙ Postgres. Заменяет `InMemoryIdempotencyKeysRepository` в `idempotency.module.ts` —
 * этот тест — доказательство, что персистентность реально переживает рестарт процесса (два
 * НЕЗАВИСИМЫХ инстанса репозитория, каждый со своим `Pool`, второй видит запись первого).
 *
 * SRS-API-010: гонка на `createProcessing` — реальный `UNIQUE(user_id, endpoint, key)` ловит
 * конкурентный дубль, не искусственный мок.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { DrizzleIdempotencyKeysRepository } from '@/common/idempotency/drizzle-idempotency-keys.repository.js'
import { IdempotencyKeyConflictError } from '@/common/idempotency/idempotency-keys.repository.js'

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

describe.skipIf(!postgresAvailable)('DrizzleIdempotencyKeysRepository — integration (DTJ-227, D-EP09-18)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let repo: DrizzleIdempotencyKeysRepository
  let tenantId: string
  let userId: string
  let createdKeyIds: string[]

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    repo = new DrizzleIdempotencyKeysRepository(db)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  beforeEach(() => {
    createdKeyIds = []
  })

  afterEach(async () => {
    await pool.query('DELETE FROM idempotency_keys WHERE id = ANY($1)', [createdKeyIds]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
  })

  async function seedUser(): Promise<{ tenant: string; user: string }> {
    const tenant = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenant, `dtj227idem-${tenant.slice(0, 8)}`])
    const user = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [user, tenant])
    return { tenant, user }
  }

  it('createProcessing → findByTriple видит `processing`-запись; markCompleted → повторный findByTriple видит `completed` с responseBody', async () => {
    ;({ tenant: tenantId, user: userId } = await seedUser())
    const endpoint = 'checkout:create-orders'
    const key = randomUUID()

    const created = await repo.createProcessing({ userId, endpoint, key, requestHash: 'hash-1' })
    createdKeyIds.push(created.id)
    expect(created.status).toBe('processing')

    const processing = await repo.findByTriple(userId, endpoint, key)
    expect(processing?.status).toBe('processing')

    await repo.markCompleted(created.id, 201, { data: { orders: [{ orderId: 'o-1' }] } })
    const completed = await repo.findByTriple(userId, endpoint, key)
    expect(completed?.status).toBe('completed')
    expect(completed?.responseStatus).toBe(201)
    expect(completed?.responseBody).toEqual({ data: { orders: [{ orderId: 'o-1' }] } })
  })

  it('createProcessing — конкурентный дубль на РЕАЛЬНОМ UNIQUE(user_id, endpoint, key) → ровно один успех, второй — IdempotencyKeyConflictError', async () => {
    ;({ tenant: tenantId, user: userId } = await seedUser())
    const endpoint = 'checkout:create-orders'
    const key = randomUUID()

    const results = await Promise.allSettled([
      repo.createProcessing({ userId, endpoint, key, requestHash: 'hash-a' }),
      repo.createProcessing({ userId, endpoint, key, requestHash: 'hash-a' }),
    ])
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof repo.createProcessing>>> => r.status === 'fulfilled')
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(IdempotencyKeyConflictError)
    createdKeyIds.push(fulfilled[0]?.value.id ?? '')
  })

  it('releaseProcessing — удаляет запись, повторный createProcessing с тем же triple снова успешен', async () => {
    ;({ tenant: tenantId, user: userId } = await seedUser())
    const endpoint = 'checkout:create-orders'
    const key = randomUUID()
    const created = await repo.createProcessing({ userId, endpoint, key, requestHash: 'hash-b' })

    await repo.releaseProcessing(created.id)

    expect(await repo.findByTriple(userId, endpoint, key)).toBeNull()
    const retried = await repo.createProcessing({ userId, endpoint, key, requestHash: 'hash-b' })
    createdKeyIds.push(retried.id)
    expect(retried.status).toBe('processing')
  })

  it('persistence переживает НЕЗАВИСИМЫЙ второй инстанс репозитория (симуляция рестарта процесса, AC5)', async () => {
    ;({ tenant: tenantId, user: userId } = await seedUser())
    const endpoint = 'checkout:create-orders'
    const key = randomUUID()
    const created = await repo.createProcessing({ userId, endpoint, key, requestHash: 'hash-c' })
    createdKeyIds.push(created.id)
    await repo.markCompleted(created.id, 201, { data: { orders: [] } })

    // Новый Pool + новый инстанс репозитория — как будто процесс перезапустился, читает ту же БД.
    const freshPool = new Pool({ connectionString: TEST_DATABASE_URL })
    const freshDb = drizzle(freshPool)
    const freshRepo = new DrizzleIdempotencyKeysRepository(freshDb)
    try {
      const found = await freshRepo.findByTriple(userId, endpoint, key)
      expect(found?.status).toBe('completed')
      expect(found?.responseBody).toEqual({ data: { orders: [] } })
    } finally {
      await freshPool.end().catch(() => undefined)
    }
  })
})
