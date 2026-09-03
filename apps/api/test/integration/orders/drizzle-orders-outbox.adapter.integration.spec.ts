/**
 * Интеграционный тест `DrizzleOrdersOutboxAdapter` (EP-09, DTJ-227, SRS-DOM-151/152) —
 * РЕАЛЬНЫЙ Postgres. Фокус — та часть DoD, что и делает этот адаптер отличным от
 * `DrizzleInventoryOutboxAdapter` (fire-and-forget): `appendAll` записан НА ПЕРЕДАННОМ `tx`
 * и ОТКАТЫВАЕТСЯ вместе с транзакцией группы, если она не коммитится.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { DrizzleOrdersOutboxAdapter } from '@/modules/orders/infrastructure/adapters/drizzle-orders-outbox.adapter.js'
import type { OrderDomainEvent } from '@/modules/orders/domain/order-domain-event.js'

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

describe.skipIf(!postgresAvailable)('DrizzleOrdersOutboxAdapter — integration (DTJ-227, SRS-DOM-151)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let adapter: DrizzleOrdersOutboxAdapter
  let tenantId: string

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    adapter = new DrizzleOrdersOutboxAdapter(db)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  beforeEach(async () => {
    tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj227outbox-${tenantId.slice(0, 8)}`])
  })

  afterEach(async () => {
    await pool.query('DELETE FROM outbox WHERE tenant_id = $1', [tenantId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
  })

  it('appendAll БЕЗ tx — пишет строку в outbox с eventType/aggregateId/payload/tenantId', async () => {
    const orderId = randomUUID()
    const event: OrderDomainEvent = { type: 'OrderConfirmedEvent', orderId, at: new Date('2026-09-02T12:00:00.000Z') }

    await adapter.appendAll(tenantId, [event], undefined)

    const rows = await pool.query<{ event_type: string; aggregate_type: string; aggregate_id: string; tenant_id: string }>(
      'SELECT event_type, aggregate_type, aggregate_id, tenant_id FROM outbox WHERE tenant_id = $1',
      [tenantId],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]?.event_type).toBe('OrderConfirmedEvent')
    expect(rows.rows[0]?.aggregate_type).toBe('order')
    expect(rows.rows[0]?.aggregate_id).toBe(orderId)
    expect(rows.rows[0]?.tenant_id).toBe(tenantId)
  })

  it('appendAll — пустой массив событий не пишет ни одной строки (no-op)', async () => {
    await adapter.appendAll(tenantId, [], undefined)
    const rows = await pool.query('SELECT 1 FROM outbox WHERE tenant_id = $1', [tenantId])
    expect(rows.rows).toHaveLength(0)
  })

  it('SRS-DOM-151 — appendAll ВНУТРИ транзакции, которая ОТКАТЫВАЕТСЯ, не оставляет строку в outbox', async () => {
    const event: OrderDomainEvent = { type: 'OrderConfirmedEvent', orderId: randomUUID(), at: new Date() }

    await db
      .transaction(async (tx) => {
        await adapter.appendAll(tenantId, [event], tx)
        throw new Error('simulated Order.create() failure inside the group transaction')
      })
      .catch(() => undefined)

    const rows = await pool.query('SELECT 1 FROM outbox WHERE tenant_id = $1', [tenantId])
    expect(rows.rows).toHaveLength(0)
  })
})
