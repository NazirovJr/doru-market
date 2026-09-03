/**
 * Интеграционный тест `DrizzleInventoryOutboxAdapter` (EP-05, DTJ-147/152/157,
 * волна 5 блок C) — РЕАЛЬНАЯ таблица `outbox`, не InMemory-фейк.
 *
 * `append`/`appendStuckSession`/`appendBatchQueued` — синхронный `void`-контракт
 * порта (см. JSDoc адаптера) поверх асинхронной записи (fire-and-forget) —
 * тест поэтому опрашивает таблицу с коротким поллингом вместо однократного
 * чтения сразу после вызова.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleInventoryOutboxAdapter } from '@/modules/inventory/infrastructure/adapters/drizzle-inventory-outbox.adapter.js'
import type {
  FullSyncSessionStuckEvent,
  InventoryBatchQueuedEvent,
  UnmatchedInventoryRowEvent,
} from '@/modules/inventory/application/ports/inventory-outbox.port.js'

const TEST_DATABASE_URL =
  process.env.INVENTORY_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500
const POLL_INTERVAL_MS = 25
const POLL_TIMEOUT_MS = 2_000

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

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`waitFor: predicate did not become true within ${String(POLL_TIMEOUT_MS)}ms`)
}

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

describe.skipIf(!postgresAvailable)('DrizzleInventoryOutboxAdapter — integration (DTJ-147/152/157)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let adapter: DrizzleInventoryOutboxAdapter
  let pharmacyId: string

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    adapter = new DrizzleInventoryOutboxAdapter(db)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000000')`,
      [id],
    )
    return id
  }

  beforeEach(async () => {
    // Не трогаем `pharmacies` (разделяемая таблица, см. отчёт сдачи блока C) —
    // свежий `pharmacyId` на тест уникален (`randomUUID()`), truncate не нужен.
    await db.execute("DELETE FROM outbox WHERE event_type LIKE 'inventory.%'")
    pharmacyId = await seedPharmacy()
  })

  it('append — UnmatchedInventoryRowEvent появляется в outbox с aggregateId=pharmacyId', async () => {
    const event: UnmatchedInventoryRowEvent = {
      eventType: 'inventory.row.unmatched',
      pharmacyId,
      rawRowPayload: {
        internalSku: 'SKU-042',
        rawBarcode: null,
        rawTradeName: 'Test Medicine',
        rawDosageForm: null,
        rawDosageStrength: null,
        rawManufacturerName: null,
      },
      reason: 'no_candidate',
    }
    adapter.append(event)
    await waitFor(async () => {
      const rows = await pool.query(
        "SELECT * FROM outbox WHERE event_type = 'inventory.row.unmatched' AND aggregate_id = $1",
        [pharmacyId],
      )
      return (rows.rowCount ?? 0) === 1
    })
    const rows = await pool.query<{ aggregate_type: string; payload: { reason: string } }>(
      "SELECT aggregate_type, payload FROM outbox WHERE event_type = 'inventory.row.unmatched' AND aggregate_id = $1",
      [pharmacyId],
    )
    expect(rows.rows[0]?.aggregate_type).toBe('inventory_sync_row')
    expect(rows.rows[0]?.payload.reason).toBe('no_candidate')
  })

  it('appendBatchQueued — событие появляется с aggregateId=batchId', async () => {
    const batchId = randomUUID()
    const event: InventoryBatchQueuedEvent = {
      eventType: 'inventory.sync_batch.queued',
      batchId,
      pharmacyId,
      channel: 'rest',
      syncType: 'delta',
    }
    adapter.appendBatchQueued(event)
    await waitFor(async () => {
      const rows = await pool.query("SELECT * FROM outbox WHERE event_type = 'inventory.sync_batch.queued' AND aggregate_id = $1", [
        batchId,
      ])
      return (rows.rowCount ?? 0) === 1
    })
  })

  it('appendStuckSession + hasStuckAlert — дедуплицирует в пределах окна, не дедуплицирует за окном', async () => {
    const sessionId = randomUUID()
    const event: FullSyncSessionStuckEvent = {
      eventType: 'inventory.full_sync_session.stuck',
      fullSyncSessionId: sessionId,
      pharmacyId,
      lastPageReceivedAt: new Date(),
    }
    // До записи — алерта ещё нет.
    expect(await adapter.hasStuckAlert(sessionId, 60)).toBe(false)

    adapter.appendStuckSession(event)
    await waitFor(() => adapter.hasStuckAlert(sessionId, 60))

    // В пределах окна (60 минут) — дедуплицируется.
    expect(await adapter.hasStuckAlert(sessionId, 60)).toBe(true)
    // За пределами окна (0 минут — "события за последние 0 минут") — не находит.
    expect(await adapter.hasStuckAlert(sessionId, 0)).toBe(false)
    // Другая сессия — не находит.
    expect(await adapter.hasStuckAlert(randomUUID(), 60)).toBe(false)
  })
})
