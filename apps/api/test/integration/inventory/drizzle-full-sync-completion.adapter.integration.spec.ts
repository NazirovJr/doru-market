/**
 * Интеграционный тест `DrizzleFullSyncCompletionAdapter` (EP-05, DTJ-151,
 * SRS-INV-041/042, волна 5 блок C) — РЕАЛЬНЫЙ Postgres, не InMemory-фейк.
 *
 * До волны 5 `FULL_SYNC_COMPLETION` был на `InMemoryFullSyncCompletion`
 * (`zeroOutMissing` — no-op, `zeroedLots: 0` всегда). При подключении
 * адаптера как активного провайдера этот тест нашёл БЛОКИРУЮЩИЙ дефект:
 * `findTouchedBatchNumbersForSession` читал JSONB-ключ `payload->>'batchNumber'`
 * (camelCase), но контроллер (`InventoryBatchUpdateController.rowToPayload`)
 * пишет payload со snake_case-ключами (`batch_number`). Ключ никогда не
 * совпадал → `touched` всегда пустой → `zeroOutMissing` обнулял ВСЕ лоты
 * аптеки старше `fullSyncTimestamp`, ВКЛЮЧАЯ только что применённые в
 * текущей сессии — обратное тому, что требует SRS-INV-041/042. Исправлено
 * (`payload->>'batch_number'`), тест ниже — регресс на этот конкретный сценарий.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleFullSyncCompletionAdapter } from '@/modules/inventory/infrastructure/adapters/drizzle-full-sync-completion.adapter.js'

const TEST_DATABASE_URL =
  process.env.INVENTORY_TEST_DATABASE_URL ??
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

describe.skipIf(!postgresAvailable)('DrizzleFullSyncCompletionAdapter — integration (DTJ-151)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let adapter: DrizzleFullSyncCompletionAdapter
  let pharmacyId: string
  let medicineId: string

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    adapter = new DrizzleFullSyncCompletionAdapter(db)
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

  /**
   * `category_id` берётся через `RETURNING`, не хардкодится `1` — `categories`
   * разделяется с другими сьютами (catalog в т.ч.) и здесь НЕ truncate'ится
   * (см. `beforeEach` ниже и отчёт сдачи блока C).
   */
  async function seedMedicine(): Promise<string> {
    const id = randomUUID()
    const category = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('root', 'Корень', 'Root', 'Root', 'otc', 0, true)
       ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
       RETURNING id`,
    )
    const categoryId = category.rows[0]?.id
    if (categoryId === undefined) {
      throw new Error('seedMedicine: failed to resolve root category id')
    }
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

  async function seedInventoryLot(params: { batchNumber: string; quantity: number; updatedAt: Date }): Promise<void> {
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at, batch_number, updated_at)
       VALUES ($1, $2, 1000, $3, '2030-01-01', $4, $5)`,
      [pharmacyId, medicineId, params.quantity, params.batchNumber, params.updatedAt],
    )
  }

  async function seedRawItemWithBatchNumber(params: {
    fullSyncSessionId: string
    batchNumber: string
  }): Promise<void> {
    const batchId = randomUUID()
    await pool.query(
      `INSERT INTO inventory_sync_batch (id, pharmacy_id, channel, sync_type, full_sync_session_id, page_number, is_last_page, total_rows)
       VALUES ($1, $2, 'rest', 'full', $3, 1, true, 1)`,
      [batchId, pharmacyId, params.fullSyncSessionId],
    )
    // Тот же payload, что реально пишет контроллер (`rowToPayload`) — snake_case ключи.
    await pool.query(
      `INSERT INTO inventory_sync_raw_items (batch_id, row_index, payload)
       VALUES ($1, 0, $2::jsonb)`,
      [batchId, JSON.stringify({ internal_sku: 'SKU-1', batch_number: params.batchNumber })],
    )
  }

  beforeEach(async () => {
    // Только СВОИ таблицы. `pharmacy_inventory`/`pharmacies`/`medicines`/`categories`
    // НЕ truncate'im — разделяются с catalog-сьютами (см. отчёт сдачи блока C);
    // все запросы этого файла уже скоупятся по свежему `pharmacyId` (`randomUUID()`).
    await db.execute('TRUNCATE inventory_sync_raw_items, inventory_sync_batch CASCADE')
    pharmacyId = await seedPharmacy()
    medicineId = await seedMedicine()
  })

  it('findTouchedBatchNumbersForSession — читает snake_case ключ batch_number из реального payload контроллера', async () => {
    const sessionId = randomUUID()
    await seedRawItemWithBatchNumber({ fullSyncSessionId: sessionId, batchNumber: 'BATCH-TOUCHED' })
    const touched = await adapter.findTouchedBatchNumbersForSession(sessionId)
    expect(touched).toContain('BATCH-TOUCHED')
  })

  it('zeroOutMissing — НЕ обнуляет партию, тронутую в текущей сессии; обнуляет НЕ тронутую', async () => {
    const sessionId = randomUUID()
    const past = new Date(Date.now() - 60_000)
    const fullSyncTimestamp = new Date()

    await seedInventoryLot({ batchNumber: 'TOUCHED', quantity: 50, updatedAt: past })
    await seedInventoryLot({ batchNumber: 'MISSING', quantity: 20, updatedAt: past })
    await seedRawItemWithBatchNumber({ fullSyncSessionId: sessionId, batchNumber: 'TOUCHED' })

    const result = await adapter.zeroOutMissing({ pharmacyId, fullSyncSessionId: sessionId, fullSyncTimestamp })
    expect(result.zeroedLots).toBe(1)

    const rows = await pool.query<{ batch_number: string; quantity: number }>(
      'SELECT batch_number, quantity FROM pharmacy_inventory WHERE pharmacy_id = $1 ORDER BY batch_number',
      [pharmacyId],
    )
    const byBatch = Object.fromEntries(rows.rows.map((r) => [r.batch_number, r.quantity]))
    expect(byBatch.TOUCHED).toBe(50) // НЕ обнулена — регресс-проверка на дефект camelCase/snake_case
    expect(byBatch.MISSING).toBe(0) // обнулена — не встретилась в текущей сессии
  })

  it('zeroOutMissing — не трогает лоты, обновлённые ПОСЛЕ fullSyncTimestamp (защита от гонки, SRS-INV-042)', async () => {
    const sessionId = randomUUID()
    const fullSyncTimestamp = new Date(Date.now() - 60_000)
    const updatedAfterSnapshot = new Date() // позже fullSyncTimestamp — гонка с параллельной дельтой

    await seedInventoryLot({ batchNumber: 'RACE', quantity: 15, updatedAt: updatedAfterSnapshot })

    const result = await adapter.zeroOutMissing({ pharmacyId, fullSyncSessionId: sessionId, fullSyncTimestamp })
    expect(result.zeroedLots).toBe(0)

    const rows = await pool.query<{ quantity: number }>('SELECT quantity FROM pharmacy_inventory WHERE pharmacy_id = $1', [pharmacyId])
    expect(rows.rows[0]?.quantity).toBe(15)
  })
})
