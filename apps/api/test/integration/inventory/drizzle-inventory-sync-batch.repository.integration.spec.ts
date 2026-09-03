/**
 * Интеграционный тест `DrizzleInventorySyncBatchRepository` (EP-05, DTJ-154,
 * волна 5 блок C) — РЕАЛЬНЫЙ Postgres, не InMemory-фейк (прямое указание
 * CTO, `docs/07-WAVE4-HANDOFF.md` §3.2).
 *
 * До волны 5 `INVENTORY_SYNC_BATCH_REPOSITORY` был на
 * `InMemoryInventorySyncBatchRepository` — принятый батч не переживал
 * рестарт процесса. Этот тест проверяет именно персистентность:
 *
 *   1. `createIfNotExists` — идемпотентность: повторный вызов с тем же
 *      `id` возвращает СУЩЕСТВУЮЩУЮ строку, `created=false`.
 *   2. `appendRawItems`/`findRawItems` — `row_index` (реальная колонка,
 *      см. `db/schema/inventory-sync-raw-items.ts` — эта проверка изначально
 *      поймала расхождение схемы с фактической миграцией, см. её JSDoc)
 *      roundtrip сохраняет `rowIndex` и `payload`.
 *   3. `findById`/`save` — FSM-агрегат переживает `restore` из реальной
 *      строки Postgres (не только `InventorySyncBatch` в памяти).
 *   4. `findIncompleteFullSyncSessions` — `HAVING bool_and(is_last_page)=false`
 *      находит зависшую сессию и НЕ находит завершённую/свежую.
 *   5. Плоский `create`/`markStatus` (легаси-путь) — тоже пишет в реальную
 *      таблицу.
 *
 * **Окружение.** `INVENTORY_TEST_DATABASE_URL` (fallback `DATABASE_URL`).
 * Недоступный Postgres — честный `describe.skipIf` (Ж13).
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleInventorySyncBatchRepository } from '@/modules/inventory/infrastructure/adapters/drizzle-inventory-sync-batch.repository.js'
import { DrizzleInventorySyncErrorsRepository } from '@/modules/inventory/infrastructure/adapters/drizzle-inventory-sync-errors.repository.js'

const TEST_DATABASE_URL =
  process.env.INVENTORY_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500
const MS_PER_MINUTE = 60_000

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

describe.skipIf(!postgresAvailable)(
  'DrizzleInventorySyncBatchRepository — integration (DTJ-154)',
  () => {
    let pool: Pool
    let db: NodePgDatabase
    let repo: DrizzleInventorySyncBatchRepository
    let pharmacyId: string

    beforeAll(() => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL })
      db = drizzle(pool)
      repo = new DrizzleInventorySyncBatchRepository(db, new DrizzleInventorySyncErrorsRepository(db))
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
      // Только СВОИ таблицы (не трогаем `pharmacies` — разделяемая другими
      // интеграционными сьютами, catalog в т.ч.; ломает их state при полном
      // прогоне, см. отчёт сдачи блока C). Свежий `pharmacyId` на тест не требует
      // truncate — уникален (`randomUUID()`), коллизий не будет.
      await db.execute('TRUNCATE inventory_sync_errors, inventory_sync_raw_items, inventory_sync_batch CASCADE')
      pharmacyId = await seedPharmacy()
    })

    it('createIfNotExists — первый вызов создаёт строку, второй с тем же id — идемпотентен (created=false)', async () => {
      const id = randomUUID()
      const now = new Date()
      const first = await repo.createIfNotExists({
        id,
        pharmacyId,
        channel: 'rest',
        syncType: 'delta',
        fullSyncSessionId: null,
        isLastPage: true,
        totalRows: 5,
        note: null,
        now,
      })
      expect(first.created).toBe(true)
      expect(first.batch.id).toBe(id)
      expect(first.batch.status).toBe('queued')

      const second = await repo.createIfNotExists({
        id,
        pharmacyId,
        channel: 'rest',
        syncType: 'delta',
        fullSyncSessionId: null,
        isLastPage: true,
        totalRows: 999, // намеренно другое значение — идемпотентность игнорирует новый payload
        note: 'ignored',
        now: new Date(),
      })
      expect(second.created).toBe(false)
      expect(second.batch.totalRows).toBe(5)

      const rows = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM inventory_sync_batch WHERE id = $1', [id])
      expect(rows.rows[0]?.n).toBe(1)
    })

    it('appendRawItems/findRawItems — roundtrip сохраняет rowIndex (реальная колонка) и payload', async () => {
      const { batch } = await repo.createIfNotExists({
        id: randomUUID(),
        pharmacyId,
        channel: 'rest',
        syncType: 'delta',
        fullSyncSessionId: null,
        isLastPage: true,
        totalRows: 2,
        note: null,
        now: new Date(),
      })
      await repo.appendRawItems(batch.id, [
        { rowIndex: 1, payload: { internal_sku: 'SKU-1', quantity: 10 } },
        { rowIndex: 0, payload: { internal_sku: 'SKU-0', quantity: 5 } },
      ])
      const items = await repo.findRawItems(batch.id)
      expect(items).toHaveLength(2)
      // Порядок — по created_at/id (вставки в одном insert почти одновременны) — сортируем сами для стабильности.
      const byIndex = [...items].sort((a, b) => a.rowIndex - b.rowIndex)
      expect(byIndex[0]).toEqual({ rowIndex: 0, payload: { internal_sku: 'SKU-0', quantity: 5 } })
      expect(byIndex[1]).toEqual({ rowIndex: 1, payload: { internal_sku: 'SKU-1', quantity: 10 } })

      // appendRawItems([]) — no-op, не должен падать и не добавляет строк.
      await repo.appendRawItems(batch.id, [])
      const itemsAfterNoop = await repo.findRawItems(batch.id)
      expect(itemsAfterNoop).toHaveLength(2)
    })

    it('findById/save — FSM-переход processing→completed_full_success переживает restore из реального Postgres', async () => {
      const { batch: created } = await repo.createIfNotExists({
        id: randomUUID(),
        pharmacyId,
        channel: 'rest',
        syncType: 'delta',
        fullSyncSessionId: null,
        isLastPage: true,
        totalRows: 3,
        note: null,
        now: new Date(),
      })
      const loaded = await repo.findById(created.id)
      expect(loaded).not.toBeNull()
      loaded?.markProcessing()
      loaded?.markCompletedFullSuccess()
      await repo.save(loaded!)

      // НОВЫЙ read — не переиспользуем `loaded` из памяти, читаем строку заново.
      const reread = await repo.findById(created.id)
      expect(reread?.status).toBe('completed_full_success')
      expect(reread?.completedAt).toBeNull() // markCompletedFullSuccess не принимает `now` — completedAt не проставляется этим переходом
    })

    it('findById — несуществующий id возвращает null', async () => {
      const result = await repo.findById(randomUUID())
      expect(result).toBeNull()
    })

    it('findIncompleteFullSyncSessions — находит зависшую сессию (нет last_page, старая), игнорирует свежую и завершённую', async () => {
      const olderThanMinutes = 30
      const staleSessionId = randomUUID()
      const freshSessionId = randomUUID()
      const completeSessionId = randomUUID()
      const oldReceivedAt = new Date(Date.now() - (olderThanMinutes + 10) * MS_PER_MINUTE)
      const freshReceivedAt = new Date()

      // Зависшая: is_last_page=false, старая received_at.
      await pool.query(
        `INSERT INTO inventory_sync_batch
           (id, pharmacy_id, channel, sync_type, full_sync_session_id, page_number, is_last_page, total_rows, received_at)
         VALUES ($1, $2, 'rest', 'full', $3, 1, false, 10, $4)`,
        [randomUUID(), pharmacyId, staleSessionId, oldReceivedAt],
      )
      // Свежая: is_last_page=false, но недавняя — НЕ должна попасть (моложе cutoff).
      await pool.query(
        `INSERT INTO inventory_sync_batch
           (id, pharmacy_id, channel, sync_type, full_sync_session_id, page_number, is_last_page, total_rows, received_at)
         VALUES ($1, $2, 'rest', 'full', $3, 1, false, 10, $4)`,
        [randomUUID(), pharmacyId, freshSessionId, freshReceivedAt],
      )
      // Завершённая: последняя страница пришла (is_last_page=true) — не "зависшая" вне зависимости от возраста.
      await pool.query(
        `INSERT INTO inventory_sync_batch
           (id, pharmacy_id, channel, sync_type, full_sync_session_id, page_number, is_last_page, total_rows, received_at)
         VALUES ($1, $2, 'rest', 'full', $3, 1, true, 10, $4)`,
        [randomUUID(), pharmacyId, completeSessionId, oldReceivedAt],
      )

      const incomplete = await repo.findIncompleteFullSyncSessions(olderThanMinutes)
      const sessionIds = incomplete.map((s) => s.fullSyncSessionId)
      expect(sessionIds).toContain(staleSessionId)
      expect(sessionIds).not.toContain(freshSessionId)
      expect(sessionIds).not.toContain(completeSessionId)
    })

    it('плоский create/markStatus (легаси) — пишет реальную строку с терминальным статусом', async () => {
      const result = await repo.create({
        pharmacyId,
        channel: 'excel',
        totalRows: 10,
        acceptedRows: 8,
        rejectedRows: 2,
        errorSummary: [{ rowIndex: 3, reason: 'bad price' }],
        note: 'legacy path test',
      })
      const row = await pool.query<{
        status: string
        total_rows: number
        accepted_rows: number
        rejected_rows: number
      }>('SELECT status, total_rows, accepted_rows, rejected_rows FROM inventory_sync_batch WHERE id = $1', [result.id])
      expect(row.rows[0]).toMatchObject({ status: 'failed_validation', total_rows: 10, accepted_rows: 8, rejected_rows: 2 })

      await repo.markStatus(result.id, 'completed_full_success')
      const updated = await pool.query<{ status: string; finished_at: Date | null }>(
        'SELECT status, finished_at FROM inventory_sync_batch WHERE id = $1',
        [result.id],
      )
      expect(updated.rows[0]?.status).toBe('completed_full_success')
      expect(updated.rows[0]?.finished_at).not.toBeNull()
    })
  },
)
