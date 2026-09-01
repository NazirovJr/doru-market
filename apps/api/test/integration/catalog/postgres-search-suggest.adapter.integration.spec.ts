/**
 * Интеграционный тест `PostgresSearchProvider.suggest()` (DTJ-186, EP-06, R1) — РЕАЛЬНЫЙ Postgres.
 *
 * Проверяет SQL-семантику `suggest()` (`SRS-CAT-027..029`), которую unit-мок
 * (`postgres-search.adapter.spec.ts`) сознательно не интерпретирует:
 *   1. TC-CAT-021 — дедупликация: несколько записей с одинаковым `trade_name` → ровно одна строка.
 *   2. AC2 — короткий префикс (`< 3` символов) использует B-tree `ix_medicines_trade_name_prefix`
 *      (`EXPLAIN`), НЕ GIN trgm.
 *   3. AC3 — длинный запрос (`>= 3` символов) находит опечатку через `pg_trgm` (пара
 *      `«цытрамон» → «Цитрамон»`, `similarity = 0.62` — та же иллюстративная пара, что
 *      `SRS-CAT-020`/DTJ-185 AC1, гарантированно выше порога `pg_trgm` что дефолтного `0.3`,
 *      что целевого `0.20` из `SRS-DB-017`).
 *   4. AC4 — `control_category = 'narcotic'` исключён из подсказок даже при точном совпадении
 *      префикса (`SRS-CAT-055`).
 *   5. `LIMIT 10` соблюдается при большем числе кандидатов.
 *
 * **Окружение.** Тот же приём, что `catalog-repository.adapter.integration.spec.ts` (DTJ-092):
 * реальный Postgres по `CATALOG_TEST_DATABASE_URL`/`DATABASE_URL`, честный `describe.skipIf` при
 * недоступности (не «зелёный по умолчанию» — CI обязан поднять БД).
 *
 * **Миграции.** Применяются `0001_extensions.sql` (`unaccent`/`pg_trgm`) + `0006_catalog_core.sql`
 * (таблица `medicines`) — как в DTJ-092. Индекс `ix_medicines_trade_name_prefix` (DTJ-181,
 * `0018_search_schema_additions.sql`) создаётся ЗДЕСЬ отдельным `CREATE INDEX`, А НЕ применением
 * ВСЕЙ миграции `0018` целиком — та миграция также создаёт `pharmacy_reliability_scores` и
 * `search_query_log`, с FK на `pharmacies`/`tenants`/`users`, которых в этой изолированной
 * фикстуре (только `categories`/`medicines`/`medicine_substances`, тот же периметр, что DTJ-092)
 * нет — применение целиком уронило бы миграцию на FOREIGN KEY violation. Текст индекса —
 * дословная копия из `0018_search_schema_additions.sql` (см. ссылку внизу файла).
 *
 * **Известное ограничение окружения (найдено при выполнении DTJ-186, не дефект этого файла):**
 * GIN trgm-индексы `ix_medicines_trade_name_trgm`/`ix_medicines_inn_name_trgm`, специфицированные
 * `docs/spec/11-database-schema.md` строки ~1431-1432 как часть базовой DDL `medicines` (EP-04,
 * DTJ-091), ОТСУТСТВУЮТ в `0006_catalog_core.sql` — миграция `medicines` не содержит их. Ветка
 * `>= 3` символов у `suggest()` от этого не теряет КОРРЕКТНОСТЬ (PostgreSQL считает `similarity()`
 * и `%` без индекса, просто последовательным сканированием) — только производительность на
 * большом объёме, что вне бюджета проверки этого тикета (Testcontainers-фикстура — единицы строк).
 * Тест AC3 (п.3 выше) поэтому проверяет ФУНКЦИОНАЛЬНЫЙ результат `pg_trgm`-ветки, а не факт
 * использования GIN-индекса в плане — см. отчёт DTJ-186, «Найденные чужие проблемы».
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-021..029, SRS-CAT-055)
 * @see docs/spec/11-database-schema.md (SRS-DB-019, готовый запрос №1)
 * @see tickets/ep05-search-map/DTJ-181.md (индекс ix_medicines_trade_name_prefix)
 * @see tickets/ep05-search-map/DTJ-186.md
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { PostgresSearchProvider } from '@/modules/catalog/infrastructure/adapters/postgres-search.adapter.js'
import { buildSuggestPrefixOnlyQuery } from '@/modules/catalog/infrastructure/adapters/postgres-suggest.sql.js'
import type { TenantId } from '@/modules/tenancy/index.js'

const TEST_DATABASE_URL =
  process.env.CATALOG_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url)
const EXTENSIONS_SQL = readFileSync(new URL('0001_extensions.sql', MIGRATIONS_DIR), 'utf8')
const CATALOG_CORE_SQL = readFileSync(new URL('0006_catalog_core.sql', MIGRATIONS_DIR), 'utf8')

/** Дословная копия индекса из `0018_search_schema_additions.sql` — см. JSDoc файла п. «Миграции». */
const TRADE_NAME_PREFIX_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS ix_medicines_trade_name_prefix
      ON medicines (lower(unaccent(trade_name)) text_pattern_ops)
      WHERE is_published = true;
`

const PROBE_TIMEOUT_MS = 1_500
const IRRELEVANT_TENANT_ID = 'irrelevant-tenant-id' as unknown as TenantId

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

describe.skipIf(!postgresAvailable)('PostgresSearchProvider.suggest() — integration (DTJ-186)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let provider: PostgresSearchProvider

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    await db.execute(EXTENSIONS_SQL)
    await db.execute(CATALOG_CORE_SQL)
    await db.execute(TRADE_NAME_PREFIX_INDEX_SQL)
    // `suggest()` не использует logger/clock/config (DTJ-185 добавил их конструктору для
    // search()/searchByBarcode()) — минимальные заглушки, этот файл их поведение не проверяет.
    provider = new PostgresSearchProvider(
      db,
      { error: () => undefined } as unknown as ConstructorParameters<typeof PostgresSearchProvider>[1],
      { now: () => new Date() },
      { searchQueryTimeoutMs: 2_000 } as unknown as ConstructorParameters<typeof PostgresSearchProvider>[3],
    )
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  async function truncateCatalog(): Promise<void> {
    await db.execute('TRUNCATE medicine_substances, medicines, categories RESTART IDENTITY CASCADE')
  }

  beforeEach(async () => {
    await truncateCatalog()
  })

  async function seedRootCategory(): Promise<void> {
    await pool.query(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('root', 'Корень', 'Root', 'Root', 'otc', 0, true)
       ON CONFLICT (slug) DO NOTHING`,
    )
  }

  interface SeedMedicineInput {
    readonly id: string
    readonly tradeName: string
    readonly innName: string
    readonly manufacturerName?: string
    readonly dosageStrength?: string
    readonly isPublished?: boolean
    readonly controlCategory?: 'none' | 'psychotropic' | 'narcotic'
    readonly isPrescriptionRequired?: boolean
  }

  async function seedMedicine(input: SeedMedicineInput): Promise<void> {
    const controlCategory = input.controlCategory ?? 'none'
    // chk_medicines_control_category_requires_rx: potent/psychotropic/narcotic обязаны иметь
    // is_prescription_required=true (SRS-DOM-015) — иначе INSERT падает на CHECK-constraint.
    const isPrescriptionRequired = input.isPrescriptionRequired ?? controlCategory !== 'none'
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, 1, 'таблетки', 'tablet', $4, 'Tajikistan', $5, $6, $7, $8, false, true)`,
      [
        input.id,
        input.tradeName,
        input.innName,
        input.dosageStrength ?? '40 мг',
        input.manufacturerName ?? 'Test Pharma',
        isPrescriptionRequired,
        controlCategory,
        input.isPublished ?? true,
      ],
    )
  }

  it('TC-CAT-021: 3 записи с одинаковым trade_name «Но-шпа» → ровно одна строка в подсказках', async () => {
    await seedRootCategory()
    await seedMedicine({
      id: '11111111-1111-4111-8111-111111111111',
      tradeName: 'Но-шпа',
      innName: 'Дротаверин',
      manufacturerName: 'Sanofi',
      dosageStrength: '40 мг',
    })
    await seedMedicine({
      id: '22222222-2222-4222-8222-222222222222',
      tradeName: 'Но-шпа',
      innName: 'Дротаверин',
      manufacturerName: 'Chinoin',
      dosageStrength: '80 мг',
    })
    await seedMedicine({
      id: '33333333-3333-4333-8333-333333333333',
      tradeName: 'Но-шпа',
      innName: 'Дротаверин',
      manufacturerName: 'Другой производитель',
      dosageStrength: '40 мг',
    })

    const result = await provider.suggest('но-ш', IRRELEVANT_TENANT_ID, 10)

    const noShpaRows = result.filter((item) => item.tradeName === 'Но-шпа')
    expect(noShpaRows).toHaveLength(1)
  })

  it('AC2: короткий префикс (2 символа) использует Index Scan на ix_medicines_trade_name_prefix, не Seq Scan', async () => {
    await seedRootCategory()
    await seedMedicine({
      id: '44444444-4444-4444-8444-444444444444',
      tradeName: 'Ношпалгин',
      innName: 'Дротаверин+Парацетамол',
    })

    // EXPLAIN на РЕАЛЬНОМ запросе адаптера (не ручной реконструкции условия) —
    // тот же билдер, что вызывает `PostgresSearchProvider.suggest()` для короткой ветки.
    const explainResult = await db.execute(sql`EXPLAIN ${buildSuggestPrefixOnlyQuery('но', 10)}`)
    const explainRows = Array.isArray(explainResult)
      ? explainResult
      : ((explainResult as { rows?: unknown[] }).rows ?? [])
    const plan = explainRows.map((row) => (row as Record<string, unknown>)['QUERY PLAN']).join('\n')

    expect(plan).toContain('ix_medicines_trade_name_prefix')
    expect(plan).not.toMatch(/Seq Scan on medicines/)

    // Функциональная проверка того же пути через сам адаптер.
    const result = await provider.suggest('но', IRRELEVANT_TENANT_ID, 10)
    expect(result.some((item) => item.tradeName === 'Ношпалгин')).toBe(true)
    expect(result.every((item) => item.matchedVia === 'prefix')).toBe(true)
  })

  it('AC3: длинный запрос (>=3) находит опечатку через pg_trgm — «цытрамон» → «Цитрамон» (SRS-CAT-020, similarity=0.62)', async () => {
    await seedRootCategory()
    await seedMedicine({
      id: '55555555-5555-4555-8555-555555555555',
      tradeName: 'Цитрамон',
      innName: 'Ацетилсалициловая кислота+Парацетамол+Кофеин',
    })

    const result = await provider.suggest('цытрамон', IRRELEVANT_TENANT_ID, 10)

    expect(result.some((item) => item.tradeName === 'Цитрамон' && item.matchedVia === 'trigram')).toBe(
      true,
    )
  })

  it('AC4: control_category=narcotic исключён даже при точном совпадении префикса (SRS-CAT-055)', async () => {
    await seedRootCategory()
    await seedMedicine({
      id: '66666666-6666-4666-8666-666666666666',
      tradeName: 'Морфин',
      innName: 'Морфин',
      controlCategory: 'narcotic',
    })
    await seedMedicine({
      id: '77777777-7777-4777-8777-777777777777',
      tradeName: 'Морфазин',
      innName: 'Что-то другое',
      controlCategory: 'none',
    })

    const result = await provider.suggest('морф', IRRELEVANT_TENANT_ID, 10)

    expect(result.some((item) => item.tradeName === 'Морфин')).toBe(false)
    expect(result.some((item) => item.tradeName === 'Морфазин')).toBe(true)
  })

  it('соблюдает LIMIT 10 при большем числе кандидатов', async () => {
    await seedRootCategory()
    for (let i = 0; i < 15; i += 1) {
      const suffix = String(i).padStart(2, '0')
      await seedMedicine({
        id: `88888888-8888-4888-8888-${String(i).padStart(12, '0')}`,
        tradeName: `Лимитин-${suffix}`,
        innName: 'Тестовое вещество',
      })
    }

    const result = await provider.suggest('лимит', IRRELEVANT_TENANT_ID, 10)

    expect(result.length).toBeLessThanOrEqual(10)
  })

  it('неопубликованный медикамент (is_published=false) не появляется в подсказках', async () => {
    await seedRootCategory()
    await seedMedicine({
      id: '99999999-9999-4999-8999-999999999999',
      tradeName: 'Черновик',
      innName: 'Тест',
      isPublished: false,
    })

    const result = await provider.suggest('черн', IRRELEVANT_TENANT_ID, 10)

    expect(result.some((item) => item.tradeName === 'Черновик')).toBe(false)
  })
})
