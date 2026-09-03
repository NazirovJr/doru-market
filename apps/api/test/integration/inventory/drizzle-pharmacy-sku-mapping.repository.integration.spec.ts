/**
 * Интеграционный тест `DrizzlePharmacySkuMappingRepository` (EP-05, DTJ-146,
 * волна 5 блок C) — РЕАЛЬНЫЙ Postgres, не InMemory-фейк. До волны 5 класс
 * существовал (компилировался), но не был подключён в `inventory.module.ts`
 * и не покрыт ни одним тестом.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzlePharmacySkuMappingRepository } from '@/modules/inventory/infrastructure/adapters/drizzle-pharmacy-sku-mapping.repository.js'

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

describe.skipIf(!postgresAvailable)('DrizzlePharmacySkuMappingRepository — integration (DTJ-146)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let repo: DrizzlePharmacySkuMappingRepository
  let pharmacyId: string
  let medicineId: string

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    repo = new DrizzlePharmacySkuMappingRepository(db)
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
   * `categories`/`medicines`/`pharmacies` — разделяемые с другими интеграционными
   * сьютами (catalog в т.ч.) — НЕ truncate'аются (см. отчёт сдачи блока C: полный
   * прогон `vitest.integration.config.ts` ловил `medicines_category_id_fkey` от
   * более ранней версии этого файла, которая делала
   * `TRUNCATE ... categories RESTART IDENTITY CASCADE`). `category_id` берётся
   * через `RETURNING`, не хардкодится `1`.
   */
  async function resolveRootCategoryId(): Promise<number> {
    const category = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('root', 'Корень', 'Root', 'Root', 'otc', 0, true)
       ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
       RETURNING id`,
    )
    const categoryId = category.rows[0]?.id
    if (categoryId === undefined) {
      throw new Error('resolveRootCategoryId: failed to resolve root category id')
    }
    return categoryId
  }

  async function seedMedicine(): Promise<string> {
    const id = randomUUID()
    const categoryId = await resolveRootCategoryId()
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
    pharmacyId = await seedPharmacy()
    medicineId = await seedMedicine()
  })

  it('findManyByPharmacyAndSkus — пустой массив skus не бьёт по БД, возвращает пустую Map', async () => {
    const result = await repo.findManyByPharmacyAndSkus(pharmacyId, [])
    expect(result.size).toBe(0)
  })

  it('upsert + findManyByPharmacyAndSkus — round-trip через реальный Postgres', async () => {
    await repo.upsert({ pharmacyId, internalSku: 'SKU-042', medicineId, matchedVia: 'barcode' })
    const result = await repo.findManyByPharmacyAndSkus(pharmacyId, ['SKU-042', 'SKU-999-absent'])
    expect(result.size).toBe(1)
    expect(result.get('SKU-042')).toEqual({ medicineId, matchedVia: 'barcode' })
    expect(result.has('SKU-999-absent')).toBe(false)
  })

  it('upsert — повторный вызов с тем же (pharmacy, sku) ОБНОВЛЯЕТ matchedVia/medicineId, не дублирует', async () => {
    await repo.upsert({ pharmacyId, internalSku: 'SKU-042', medicineId, matchedVia: 'barcode' })
    const secondMedicineId = randomUUID()
    // FK на medicines — нужна валидная строка.
    const categoryId = await resolveRootCategoryId()
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, true)`,
      [secondMedicineId, `Trade-${secondMedicineId}`, `INN-${secondMedicineId}`, categoryId],
    )
    await repo.upsert({ pharmacyId, internalSku: 'SKU-042', medicineId: secondMedicineId, matchedVia: 'manual_resolve' })

    const rows = await pool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM pharmacy_sku_mapping WHERE pharmacy_id = $1 AND internal_sku = $2',
      [pharmacyId, 'SKU-042'],
    )
    expect(rows.rows[0]?.n).toBe(1)

    const result = await repo.findManyByPharmacyAndSkus(pharmacyId, ['SKU-042'])
    expect(result.get('SKU-042')).toEqual({ medicineId: secondMedicineId, matchedVia: 'manual_resolve' })
  })

  it('findManyByPharmacyAndSkus — БАТЧЕВЫЙ запрос находит несколько SKU одним вызовом', async () => {
    await repo.upsert({ pharmacyId, internalSku: 'SKU-A', medicineId, matchedVia: 'name_fuzzy' })
    await repo.upsert({ pharmacyId, internalSku: 'SKU-B', medicineId, matchedVia: 'barcode' })
    const result = await repo.findManyByPharmacyAndSkus(pharmacyId, ['SKU-A', 'SKU-B', 'SKU-C'])
    expect(result.size).toBe(2)
    expect(result.get('SKU-A')?.matchedVia).toBe('name_fuzzy')
    expect(result.get('SKU-B')?.matchedVia).toBe('barcode')
  })
})
