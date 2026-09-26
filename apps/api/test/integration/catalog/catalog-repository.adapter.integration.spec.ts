/**
 * Интеграционный тест `CatalogRepositoryAdapter` (DTJ-092, EP-04, R1) — РЕАЛЬНЫЙ Postgres.
 *
 * Это integration-слой, проверяющий Drizzle-адаптер против настоящей БД (не in-memory мок —
 * см. `catalog-repository.adapter.spec.ts` для unit-покрытия). Цели:
 *
 *   1. `findMedicineById` — найден / не найден / с несколькими веществами (N+1 нет:
 *      ровно 2 SQL-обращения — medicines + medicine_substances).
 *   2. `findMedicinesByIds` — пустой массив на входе → пустой массив, не ошибка; батч.
 *   3. `findSubstancesByMedicineIds` — батч-группировка по `medicineId`.
 *   4. `findCategoryTree` — плоская таблица → корректное вложенное дерево (SRS-CAT-004).
 *
 * **Окружение.** БД берётся из `CATALOG_TEST_DATABASE_URL` (fallback: `DATABASE_URL`,
 * дефолт совпадает с `vitest.integration.config.ts`). Если Postgres недоступен —
 * сьют пропускается через `describe.skipIf` (тот же приём, что в
 * `apps/worker/.../health.integration.spec.ts`, SRS-NFR-048/Ж13): это не «зелёный
 * по умолчанию», а честный skip, который CI обязан запустить с поднятой БД.
 *
 * Миграции применяются ПРЯМО из `apps/api/migrations/` (extensions + catalog core),
 * идемпотентно (`IF NOT EXISTS`), в изолированной схеме теста. Truncate между кейсами
 * даёт чистую фикстуру без зависимости от порядка.
 *
 * @see docs/spec/11-database-schema.md (DDL categories/substances/medicines/medicine_substances)
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 3 (оживить каталог)
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { CatalogRepositoryAdapter } from '@/modules/catalog/infrastructure/adapters/catalog-repository.adapter.js'
import type { CatalogRepository } from '@/modules/catalog/application/ports/catalog-repository.port.js'

/** Тестовая БД: override через ENV на случай конкретного стенда; дефолт — как в `vitest.integration.config.ts`. */
const TEST_DATABASE_URL =
  process.env.CATALOG_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url)
const EXTENSIONS_SQL = readFileSync(new URL('0001_extensions.sql', MIGRATIONS_DIR), 'utf8')
const CATALOG_CORE_SQL = readFileSync(new URL('0006_catalog_core.sql', MIGRATIONS_DIR), 'utf8')

/**
 * ИСПРАВЛЕНО (гейт CI): `EXTENSIONS_SQL`/`CATALOG_CORE_SQL` реплеились под ролью `test` — при
 * уже применённых реальных миграциях `CREATE OR REPLACE FUNCTION immutable_unaccent` падает
 * `must be owner of function immutable_unaccent`. DDL теперь идёт под ОТДЕЛЬНЫМ `migratorPool`
 * (тот же приём, что `i18n-overrides-catalog.seed.integration.spec.ts`).
 */
const MIGRATOR_DATABASE_URL = process.env.CATALOG_MIGRATOR_DATABASE_URL ?? buildMigratorUrl(TEST_DATABASE_URL)

function buildMigratorUrl(appUrl: string): string {
  try {
    const url = new URL(appUrl)
    url.username = 'dorutj_migrator'
    url.password = 'dorutj_dev_only_password'
    return url.toString()
  } catch {
    return appUrl
  }
}

const CATEGORY_ACTIVE_TRUE = 1
const SUBSTANCE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUBSTANCE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MEDICINE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEDICINE_ID_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

/** Короткий таймаут пробы соединения — не блокируем сьют на недоступном Postgres. */
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
const migratorAvailable = postgresAvailable && (await isPostgresReachable(MIGRATOR_DATABASE_URL))

describe.skipIf(!postgresAvailable || !migratorAvailable)('CatalogRepositoryAdapter — integration (DTJ-092, SRS-CAT-005)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let migratorPool: Pool
  let repo: CatalogRepository
  let queryCount: number

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    migratorPool = new Pool({ connectionString: MIGRATOR_DATABASE_URL })
    // Счётчик SQL-обращений через штатный Drizzle-логгер — страховка от N+1
    // (SRS-CAT-005): каждый исполненный запрос инкрементирует queryCount, без
    // monkey-patch пула.
    queryCount = 0
    db = drizzle(pool, {
      logger: {
        logQuery: () => {
          queryCount += 1
        },
      },
    })
    // DDL — под ролью-владельцем `dorutj_migrator` (см. блок «ИСПРАВЛЕНО» у объявления
    // MIGRATOR_DATABASE_URL).
    await migratorPool.query(EXTENSIONS_SQL)
    await migratorPool.query(CATALOG_CORE_SQL)
    repo = new CatalogRepositoryAdapter(db)
  })

  afterAll(async () => {
    await migratorPool.end().catch(() => undefined)
    await pool.end().catch(() => undefined)
  })

  async function truncateCatalog(): Promise<void> {
    // `RESTART IDENTITY` требует владения sequence — `test` им не владеет (см. блок
    // «ИСПРАВЛЕНО» у объявления MIGRATOR_DATABASE_URL) — под `migratorPool`.
    await migratorPool.query(
      'TRUNCATE medicine_substances, medicines, categories, substances RESTART IDENTITY CASCADE',
    )
  }

  beforeEach(async () => {
    await truncateCatalog()
  })

  async function seedSubstance(id: string, innName: string): Promise<void> {
    // pool.query вместо db.execute: Drizzle 0.45 `db.execute` принимает только
    // SQL или `{ sql, params }`-объект, не pg-стиль `[values]`. Тесту нужен
    // низкоуровневый параметризованный SQL, и подменённый пул (`queryCount`)
    // уже подсчитывает вызовы, поэтому `pool.query` сохраняет N+1-инвариант.
    await pool.query('INSERT INTO substances (id, inn_name) VALUES ($1, $2)', [id, innName])
  }

  async function seedMedicineWithSubstances(
    id: string,
    substances: readonly { substanceId: string; strengthValue: number; strengthUnit: string }[],
  ): Promise<void> {
    // category_id FK требует существующую категорию — создаём одну общую рут-категорию.
    // ON CONFLICT DO NOTHING: seedMedicineWithSubstances() вызывается дважды в одном тесте
    // (для MEDICINE_ID и MEDICINE_ID_2, например в findMedicinesByIds/findSubstancesByMedicineIds) —
    // без него второй INSERT падает на unique constraint categories_slug_key (beforeEach truncate
    // работает между тестами, но не внутри одного).
    await pool.query(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('root', 'Корень', 'Root', 'Root', 'otc', 0, $1)
       ON CONFLICT (slug) DO NOTHING`,
      [CATEGORY_ACTIVE_TRUE],
    )
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, 1, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, true)`,
      [id, `Trade-${id}`, `INN-${id}`],
    )
    for (const s of substances) {
      await pool.query(
        'INSERT INTO medicine_substances (medicine_id, substance_id, strength_value, strength_unit) VALUES ($1, $2, $3, $4)',
        [id, s.substanceId, String(s.strengthValue), s.strengthUnit],
      )
    }
  }

  it('findMedicineById возвращает MedicineRecord с substances[] за 2 SQL-запроса (без N+1)', async () => {
    await seedSubstance(SUBSTANCE_A, 'Paracetamol')
    await seedSubstance(SUBSTANCE_B, 'Ibuprofen')
    await seedMedicineWithSubstances(MEDICINE_ID, [
      { substanceId: SUBSTANCE_A, strengthValue: 500, strengthUnit: 'mg' },
      { substanceId: SUBSTANCE_B, strengthValue: 200, strengthUnit: 'mg' },
    ])

    queryCount = 0
    const result = await repo.findMedicineById(MEDICINE_ID)

    expect(result).not.toBeNull()
    expect(result?.id).toBe(MEDICINE_ID)
    expect(result?.substances).toHaveLength(2)
    // N+1-инвариант: medicines (1) + medicine_substances (1) — ровно 2, не 3.
    expect(queryCount).toBe(2)
  })

  it('findMedicineById возвращает null для несуществующего id (не бросает)', async () => {
    const result = await repo.findMedicineById('00000000-0000-4000-8000-000000000000')
    expect(result).toBeNull()
  })

  it('findMedicinesByIds([]) возвращает [] без SQL-вызовов', async () => {
    queryCount = 0
    const result = await repo.findMedicinesByIds([])
    expect(result).toEqual([])
    expect(queryCount).toBe(0)
  })

  it('findMedicinesByIds возвращает только найденные записи (батч, без N+1)', async () => {
    await seedSubstance(SUBSTANCE_A, 'Paracetamol')
    await seedMedicineWithSubstances(MEDICINE_ID, [
      { substanceId: SUBSTANCE_A, strengthValue: 500, strengthUnit: 'mg' },
    ])
    await seedMedicineWithSubstances(MEDICINE_ID_2, [
      { substanceId: SUBSTANCE_A, strengthValue: 250, strengthUnit: 'mg' },
    ])

    queryCount = 0
    const result = await repo.findMedicinesByIds([
      MEDICINE_ID,
      MEDICINE_ID_2,
      '00000000-0000-4000-8000-000000000000',
    ])
    expect(result).toHaveLength(2)
    expect(new Set(result.map((r) => r.id))).toEqual(new Set([MEDICINE_ID, MEDICINE_ID_2]))
    // medicines (1) + medicine_substances (1) — ровно 2.
    expect(queryCount).toBe(2)
  })

  it('findSubstancesByMedicineIds группирует вещества по medicineId (батч)', async () => {
    await seedSubstance(SUBSTANCE_A, 'Paracetamol')
    await seedSubstance(SUBSTANCE_B, 'Ibuprofen')
    await seedMedicineWithSubstances(MEDICINE_ID, [
      { substanceId: SUBSTANCE_A, strengthValue: 500, strengthUnit: 'mg' },
      { substanceId: SUBSTANCE_B, strengthValue: 200, strengthUnit: 'mg' },
    ])
    await seedMedicineWithSubstances(MEDICINE_ID_2, [
      { substanceId: SUBSTANCE_A, strengthValue: 100, strengthUnit: 'mg' },
    ])

    const result = await repo.findSubstancesByMedicineIds([MEDICINE_ID, MEDICINE_ID_2])
    expect(result.size).toBe(2)
    expect(result.get(MEDICINE_ID)).toHaveLength(2)
    expect(result.get(MEDICINE_ID_2)).toHaveLength(1)
  })

  it('findCategoryTree строит корректное дерево глубиной 3 из плоской таблицы (SRS-CAT-004)', async () => {
    await pool.query(
      `INSERT INTO categories (id, parent_id, slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active) VALUES
         (1, NULL, 'root',   'R-tj', 'R-ru', 'R-en', 'otc', 0, $1),
         (2, 1,    'child',  'C-tj', 'C-ru', 'C-en', 'otc', 0, $1),
         (3, 2,    'leaf',   'L-tj', 'L-ru', 'L-en', 'otc', 0, $1),
         (4, NULL, 'hidden', 'H-tj', 'H-ru', 'H-en', 'otc', 0, $2)`,
      [CATEGORY_ACTIVE_TRUE, 0],
    )
    // Восстановить sequence после явных id, чтобы сериал не конфликтовал с pk. `setval()`
    // требует UPDATE-привилегию на sequence — `test` намеренно её не имеет (`ALTER DEFAULT
    // PRIVILEGES ... GRANT USAGE, SELECT ON SEQUENCES`, `infra/docker/postgres-init/
    // 01-test-database.sql`) — под `migratorPool` (владелец), как и остальной DDL этого файла.
    await migratorPool.query("SELECT setval(pg_get_serial_sequence('categories', 'id'), 4, true)")

    const tree = await repo.findCategoryTree()
    expect(tree).toHaveLength(1)
    const root = tree[0]
    expect(root?.id).toBe(1)
    expect(root?.children).toHaveLength(1)
    expect(root?.children[0]?.id).toBe(2)
    expect(root?.children[0]?.children[0]?.id).toBe(3)
  })
})