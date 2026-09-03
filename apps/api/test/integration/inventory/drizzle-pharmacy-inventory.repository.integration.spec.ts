/**
 * Интеграционный тест `DrizzlePharmacyInventoryRepository` (EP-05, DTJ-154,
 * волна 5 блок C) — РЕАЛЬНЫЙ Postgres, не InMemory-фейк.
 *
 * До волны 5 этот класс существовал (написан, компилировался), но не был
 * подключён ни в `inventory.module.ts` (провайдер оставался InMemory), ни
 * покрыт ни одним тестом — ровно тот класс дефекта, о котором предупреждает
 * `AGENTS.md` правило 2 («написанный, но неподключённый код проходит все
 * статические проверки и создаёт иллюзию готовности»).
 *
 * Этот тест также ловит реальный баг, найденный при подключении: `saveMany`
 * писал `price: lot.price.diram` (`bigint`) напрямую в колонку `integer`
 * без конверсии — исправлено на `Number(lot.price.diram)` (см. правку файла).
 * Тест №3 ниже проверяет именно эту конверсию — обновлённая цена читается
 * корректным `number`, не падает и не искажается.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzlePharmacyInventoryRepository } from '@/modules/inventory/infrastructure/adapters/drizzle-pharmacy-inventory.repository.js'
import { InventoryBatchUpsertRow } from '@/modules/inventory/domain/value-objects/inventory-batch-upsert-row.vo.js'

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

describe.skipIf(!postgresAvailable)('DrizzlePharmacyInventoryRepository — integration (DTJ-154)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let repo: DrizzlePharmacyInventoryRepository
  let pharmacyId: string
  let medicineId: string

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    repo = new DrizzlePharmacyInventoryRepository(db)
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
   * `categories`/`medicines`/`pharmacies` — таблицы, разделяемые с другими
   * интеграционными сьютами (catalog в т.ч.) — НЕ truncate'аются здесь (см.
   * отчёт сдачи блока C: полный прогон `vitest.integration.config.ts` ловил
   * `medicines_category_id_fkey`, потому что более ранняя версия этого файла
   * делала `TRUNCATE ... categories RESTART IDENTITY CASCADE`, ломая
   * `category_id` catalog-сьютов). `category_id` берётся через `RETURNING`,
   * не хардкодится `1` — корректно независимо от порядка выполнения файлов.
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

  beforeEach(async () => {
    // Свежие `pharmacyId`/`medicineId` на каждый тест (`randomUUID()`) — коллизий
    // нет, truncate таблиц не требуется (и был бы опасен, см. JSDoc `seedMedicine`).
    pharmacyId = await seedPharmacy()
    medicineId = await seedMedicine()
  })

  function buildRow(params: { price: number; quantity: number; expiresAt: string; batchNumber?: string | null }) {
    const result = InventoryBatchUpsertRow.create(
      {
        medicineId,
        barcode: null,
        price: params.price,
        quantity: params.quantity,
        expiresAt: params.expiresAt,
        batchNumber: params.batchNumber ?? null,
      },
      new Date('2020-01-01T00:00:00Z'),
    )
    if (!result.ok) {
      throw new Error(`buildRow: unexpected validation failure: ${result.error.message}`)
    }
    return result.value
  }

  it('upsertMany — вставляет строку, видна напрямую в pharmacy_inventory', async () => {
    const row = buildRow({ price: 1250, quantity: 30, expiresAt: '2030-01-01' })
    const result = await repo.upsertMany({ pharmacyId, rows: [row] })
    expect(result.acceptedCount).toBe(1)

    const dbRows = await pool.query<{ price: number; quantity: number }>(
      'SELECT price, quantity, expires_at FROM pharmacy_inventory WHERE pharmacy_id = $1 AND medicine_id = $2',
      [pharmacyId, medicineId],
    )
    expect(dbRows.rowCount).toBe(1)
    expect(dbRows.rows[0]?.price).toBe(1250)
    expect(dbRows.rows[0]?.quantity).toBe(30)
  })

  it('upsertMany — повторный вызов с тем же (pharmacy,medicine,batch,expires) ОБНОВЛЯЕТ, не дублирует (FEFO ON CONFLICT)', async () => {
    const first = buildRow({ price: 1000, quantity: 10, expiresAt: '2030-01-01', batchNumber: 'B1' })
    await repo.upsertMany({ pharmacyId, rows: [first] })
    const second = buildRow({ price: 1500, quantity: 25, expiresAt: '2030-01-01', batchNumber: 'B1' })
    await repo.upsertMany({ pharmacyId, rows: [second] })

    const dbRows = await pool.query<{ price: number; quantity: number }>(
      'SELECT price, quantity FROM pharmacy_inventory WHERE pharmacy_id = $1 AND medicine_id = $2',
      [pharmacyId, medicineId],
    )
    expect(dbRows.rowCount).toBe(1)
    expect(dbRows.rows[0]?.price).toBe(1500)
    expect(dbRows.rows[0]?.quantity).toBe(25)
  })

  it('findOrCreateManyByMedicineIds + saveMany — round-trip через агрегат, price (bigint→integer) сохраняется корректно', async () => {
    const row = buildRow({ price: 999, quantity: 5, expiresAt: '2030-06-15', batchNumber: 'FEFO-1' })
    await repo.upsertMany({ pharmacyId, rows: [row] })

    const aggregates = await repo.findOrCreateManyByMedicineIds({ pharmacyId, medicineIds: [medicineId] })
    const aggregate = aggregates.get(medicineId)
    expect(aggregate).toBeDefined()

    const applyResult = aggregate?.applyDelta({
      batchNumber: 'FEFO-1',
      priceDiram: 7777n,
      quantity: 42,
      expiryDateIso: '2030-06-15',
      // Должен быть ПОЗЖЕ `updated_at`, проставленного при INSERT существующего лота
      // (`applyDelta` отклоняет дельту не новее существующего лота как "stale", SRS-DOM-024).
      lastSyncedAt: new Date(Date.now() + 60_000),
    })
    expect(applyResult?.applied).toBe(true)

    await repo.saveMany([aggregate!])

    const dbRows = await pool.query<{ price: number; quantity: number }>(
      'SELECT price, quantity FROM pharmacy_inventory WHERE pharmacy_id = $1 AND medicine_id = $2 AND batch_number = $3',
      [pharmacyId, medicineId, 'FEFO-1'],
    )
    expect(dbRows.rowCount).toBe(1)
    // Регресс-проверка: price должен быть number 7777, не строка/NaN/BigInt-serialization artefact.
    expect(dbRows.rows[0]?.price).toBe(7777)
    expect(typeof dbRows.rows[0]?.price).toBe('number')
    expect(dbRows.rows[0]?.quantity).toBe(42)
  })

  it('findOrCreateManyByMedicineIds + applyDelta + saveMany — БЕЗ предварительного upsertMany (регресс живой приёмки): новый лот реально INSERT, не молча теряется', async () => {
    // Ключевой сценарий, отличающий этот тест от предыдущего: НЕТ
    // предварительного `upsertMany` — точно то, что происходит при ПЕРВОЙ
    // синхронизации остатка для (pharmacyId, medicineId, batchNumber).
    // Раньше `saveMany` делал голый `UPDATE` — 0 задетых строк, тихая потеря
    // данных (найдено живой приёмкой `node dist/main.js` через боевой
    // `POST /inventory/batch-update`, см. JSDoc `upsertLot`).
    const aggregates = await repo.findOrCreateManyByMedicineIds({ pharmacyId, medicineIds: [medicineId] })
    const aggregate = aggregates.get(medicineId)
    expect(aggregate).toBeDefined()

    const applyResult = aggregate?.applyDelta({
      batchNumber: 'FIRST-SYNC',
      priceDiram: 5555n,
      quantity: 10,
      expiryDateIso: '2031-01-01',
      lastSyncedAt: new Date(),
    })
    expect(applyResult?.applied).toBe(true)

    await repo.saveMany([aggregate!])

    const dbRows = await pool.query<{ price: number; quantity: number }>(
      'SELECT price, quantity FROM pharmacy_inventory WHERE pharmacy_id = $1 AND medicine_id = $2 AND batch_number = $3',
      [pharmacyId, medicineId, 'FIRST-SYNC'],
    )
    expect(dbRows.rowCount).toBe(1)
    expect(dbRows.rows[0]?.price).toBe(5555)
    expect(dbRows.rows[0]?.quantity).toBe(10)
  })

  it('findOrCreateManyByMedicineIds — отсутствующая запись создаёт пустой агрегат (не падает), без записи в БД до save', async () => {
    const otherMedicineId = randomUUID()
    // Не seed'им pharmacy_inventory для otherMedicineId — агрегат должен быть создан "пустым".
    const aggregates = await repo.findOrCreateManyByMedicineIds({ pharmacyId, medicineIds: [otherMedicineId] })
    expect(aggregates.has(otherMedicineId)).toBe(true)
    const dbRows = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM pharmacy_inventory WHERE medicine_id = $1', [
      otherMedicineId,
    ])
    expect(dbRows.rows[0]?.n).toBe(0)
  })
})
