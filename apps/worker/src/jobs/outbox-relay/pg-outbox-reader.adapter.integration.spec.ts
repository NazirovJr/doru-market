// Реальный Postgres (describe.skipIf), таблица outbox общая с другими параллельными процессами,
// поэтому CLAIM_LIMIT большой и каждый claim() идёт через try/finally c commit().
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { OutboxClaim } from './outbox-reader.port.js'
import { PgOutboxReaderAdapter } from './pg-outbox-reader.adapter.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const CLAIM_LIMIT = 10_000

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

interface OutboxRow {
  readonly id: string
  readonly status: string
  readonly published_at: Date | null
  readonly publish_attempts: number
}

describe.skipIf(!postgresAvailable)('PgOutboxReaderAdapter — integration (DTJ-031)', () => {
  let pool: Pool
  let adapter: PgOutboxReaderAdapter
  const insertedIds: string[] = []

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    adapter = new PgOutboxReaderAdapter(pool)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await pool.query('DELETE FROM outbox WHERE id = $1', [id]).catch(() => undefined)
    }
  })

  async function seedPending(eventType = 'OrderCreatedEvent'): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO outbox (id, event_type, aggregate_type, aggregate_id, payload, tenant_id, status)
       VALUES ($1, $2, 'order', $3, $4::jsonb, $5, 'pending')`,
      [id, eventType, randomUUID(), JSON.stringify({ orderId: id }), randomUUID()],
    )
    insertedIds.push(id)
    return id
  }

  async function loadRow(id: string): Promise<OutboxRow | undefined> {
    const result = await pool.query<OutboxRow>(
      'SELECT id, status, published_at, publish_attempts FROM outbox WHERE id = $1',
      [id],
    )
    return result.rows[0]
  }

  // commit() даже при упавшем body — иначе транзакция держит чужие строки залоченными.
  async function withClaim<T>(limit: number, body: (claim: OutboxClaim) => Promise<T>): Promise<T> {
    const claim = await adapter.claimPending(limit)
    try {
      return await body(claim)
    } finally {
      await claim.commit()
    }
  }

  it('АС1: pending-строка — claim + markPublished + commit даёт published с published_at', async () => {
    const id = await seedPending()

    await withClaim(CLAIM_LIMIT, async (claim) => {
      expect(claim.events.map((event) => event.id)).toContain(id)
      await claim.markPublished(id)
    })

    const row = await loadRow(id)
    expect(row?.status).toBe('published')
    expect(row?.published_at).not.toBeNull()
  })

  it('АС2: recordFailure оставляет строку pending с publish_attempts=1, следующий тик снова её видит', async () => {
    const id = await seedPending()

    await withClaim(CLAIM_LIMIT, (claim) => claim.recordFailure(id))

    const row = await loadRow(id)
    expect(row?.status).toBe('pending')
    expect(row?.publish_attempts).toBe(1)

    await withClaim(CLAIM_LIMIT, (claim) => {
      expect(claim.events.map((event) => event.id)).toContain(id)
      return Promise.resolve()
    })
  })

  it('АС3: два конкурентных claimPending() над одним батчем — каждая строка забирается ровно одним клеймом', async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, () => seedPending()))

    const [claimA, claimB] = await Promise.all([adapter.claimPending(CLAIM_LIMIT), adapter.claimPending(CLAIM_LIMIT)])
    try {
      const idsA = new Set(claimA.events.map((event) => event.id).filter((eventId) => ids.includes(eventId)))
      const idsB = new Set(claimB.events.map((event) => event.id).filter((eventId) => ids.includes(eventId)))

      for (const id of idsA) {
        expect(idsB.has(id)).toBe(false)
      }
      expect(idsA.size + idsB.size).toBe(ids.length)

      // Последовательно — один pg.PoolClient на клейм.
      for (const event of claimA.events.filter((candidate) => ids.includes(candidate.id))) {
        await claimA.markPublished(event.id)
      }
      for (const event of claimB.events.filter((candidate) => ids.includes(candidate.id))) {
        await claimB.markPublished(event.id)
      }
    } finally {
      await Promise.all([claimA.commit(), claimB.commit()])
    }

    const rows = await Promise.all(ids.map((id) => loadRow(id)))
    for (const row of rows) {
      expect(row?.status).toBe('published')
    }
  })
})
