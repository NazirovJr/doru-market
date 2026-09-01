/**
 * Интеграционный тест `PostgresSearchProvider.search()`/`searchByBarcode()` (DTJ-185, EP-06, R1)
 * — РЕАЛЬНЫЙ Postgres.
 *
 * Покрывает 5 критериев приёмки тикета дословно + релевантные `TC-CAT-*` из тест-плана
 * (001, 002 частично, 003 частично, 004, 005, 017/077, 019, 025). Схема поднимается через
 * РЕАЛЬНЫЙ раннер `drizzle-orm/node-postgres/migrator` (`migrate()`, тот же путь, что
 * `infrastructure/database/migrate.ts` в проде) поверх ВСЕХ миграций по порядку — не ручной
 * список файлов (тот же приём, что `catalog-repository.adapter.integration.spec.ts`, но шире:
 * этому тесту нужны `tenants`/`pharmacy_chains`/`pharmacies`/`pharmacy_inventory`/
 * `pharmacy_reliability_scores`, не только `medicines`).
 *
 * **AC4 (таймаут, SRS-CAT-075/TC-CAT-025)**: вместо `pg_sleep`-представления (упомянуто в
 * тикете как один из вариантов) — экстремально низкий `SEARCH_QUERY_TIMEOUT_MS=1` через мок
 * `AppConfigService`. Эквивалентно по сути (гарантированный `57014` от РЕАЛЬНОГО Postgres на
 * ЛЮБОМ запросе), проще и не требует правки схемы вне `files_owned`.
 *
 * **AC1 (`finalScore=0.770`, TC-CAT-002/SRS-CAT-020)**: `similarity('Цитрамон','цытрамон')=0.62`
 * — каноническое значение из спецификации §3.2, ТА ЖЕ пара, что уже использует интеграционный
 * тест DTJ-186 (`postgres-search-suggest.adapter.integration.spec.ts`, AC3) как «гарантированно
 * выше порога pg_trgm». Значение НЕ пересчитано здесь заново (зависит от версии `pg_trgm`) —
 * тест доверяет каноническому примеру спецификации, как и его предшественник.
 *
 * **Окружение**: см. JSDoc `postgres-search-suggest.adapter.integration.spec.ts` — тот же
 * `describe.skipIf`, честный skip при недоступном Postgres (не «зелёный по умолчанию»).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-013..024, 044-048, 055-056, 075, 077)
 * @see tickets/ep05-search-map/DTJ-185.md
 */
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import pino from 'pino'
import { PostgresSearchProvider } from '@/modules/catalog/infrastructure/adapters/postgres-search.adapter.js'
import { SearchTemporarilyDegradedError } from '@/modules/catalog/domain/errors/search-temporarily-degraded.error.js'
import { TenantId } from '@/modules/tenancy/index.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { SearchQuery } from '@/modules/catalog/application/search/ports/search-provider.port.js'

const TEST_DATABASE_URL =
  process.env.CATALOG_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations/', import.meta.url))
const PROBE_TIMEOUT_MS = 1_500
const NEUTRAL_TENANT_ID = '00000000-0000-4000-8000-000000000001'
const CHAIN_ID = '00000000-0000-4000-8000-000000000002'
const PHARMACY_ID = '00000000-0000-4000-8000-000000000003'
const CATEGORY_ID = 1
const CENTER = { lat: 38.55, lon: 68.78 } // Душанбе, точка отсчёта для гео-тестов

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

function baseSearchQuery(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    tenantId: TenantId.from(NEUTRAL_TENANT_ID),
    text: '',
    locale: 'ru',
    filters: { inStockOnly: false, openNowOnly: false, is24x7Only: false },
    sort: 'relevance',
    limit: 20,
    ...overrides,
  }
}

describe.skipIf(!postgresAvailable)('PostgresSearchProvider.search() — integration (DTJ-185)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let provider: PostgresSearchProvider

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
    const logger = pino({ enabled: false })
    provider = new PostgresSearchProvider(
      db,
      logger,
      { now: () => new Date() },
      { searchQueryTimeoutMs: 2_000 } as ConstructorParameters<typeof PostgresSearchProvider>[3],
    )
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  async function truncateAll(): Promise<void> {
    await db.execute(
      'TRUNCATE pharmacy_reliability_scores, pharmacy_inventory, pharmacies, pharmacy_chains, tenants, medicine_substances, medicines, categories RESTART IDENTITY CASCADE',
    )
  }

  async function seedBaseFixtures(): Promise<void> {
    await pool.query(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('root', 'Корень', 'Root', 'Root', 'otc', 0, true)`,
    )
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, 'neutral', true)`, [NEUTRAL_TENANT_ID])
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status, tenant_id)
       VALUES ($1, 'Сеть 1', 'ООО Сеть 1', '000000001', 'active', NULL)`,
      [CHAIN_ID],
    )
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, 'Аптека 1', 'ул. Тестовая 1', $3, $4, '+992900000000', 'active')`,
      [PHARMACY_ID, CHAIN_ID, CENTER.lat, CENTER.lon],
    )
  }

  beforeEach(async () => {
    await truncateAll()
    await seedBaseFixtures()
  })

  interface SeedMedicineInput {
    readonly id: string
    readonly tradeName: string
    readonly innName: string
    readonly barcode?: string | null
    readonly controlCategory?: 'none' | 'potent' | 'psychotropic' | 'narcotic'
    readonly isPublished?: boolean
  }

  async function seedMedicine(input: SeedMedicineInput): Promise<void> {
    const controlCategory = input.controlCategory ?? 'none'
    const isPrescriptionRequired = controlCategory !== 'none'
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, barcode, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, $5, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma', $6, $7, $8, false, true)`,
      [
        input.id,
        input.tradeName,
        input.innName,
        input.barcode ?? null,
        CATEGORY_ID,
        isPrescriptionRequired,
        controlCategory,
        input.isPublished ?? true,
      ],
    )
  }

  interface SeedOfferInput {
    readonly medicineId: string
    readonly pharmacyId?: string
    readonly priceDiram: number
    readonly quantity?: number
  }

  async function seedOffer(input: SeedOfferInput): Promise<void> {
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $2, $3, $4, CURRENT_DATE + INTERVAL '1 year')`,
      [input.pharmacyId ?? PHARMACY_ID, input.medicineId, input.priceDiram, input.quantity ?? 10],
    )
  }

  async function seedReliability(pharmacyId: string, score: number): Promise<void> {
    await pool.query(
      `INSERT INTO pharmacy_reliability_scores (pharmacy_id, score) VALUES ($1, $2)
       ON CONFLICT (pharmacy_id) DO UPDATE SET score = EXCLUDED.score`,
      [pharmacyId, score],
    )
  }

  it('AC1/TC-CAT-002/SRS-CAT-020: опечатка «цытрамон» находит «Цитрамон», finalScore = 0.770 ± 0.001', async () => {
    const medicineId = '10000000-0000-4000-8000-000000000001'
    await seedMedicine({ id: medicineId, tradeName: 'Цитрамон', innName: 'Ацетилсалициловая кислота' })
    await seedOffer({ medicineId, priceDiram: 1200 })
    await seedReliability(PHARMACY_ID, 4.2)

    const geo = GeoPoint.create(CENTER.lat + 0.0072, CENTER.lon) // ~800м к северу
    if (!geo.ok) throw new Error('fixture GeoPoint invalid')

    const result = await provider.search(
      baseSearchQuery({ text: 'цытрамон', geo: geo.value, radiusMeters: 5000 }),
    )

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.tradeName).toBe('Цитрамон')
    expect(result.items[0]?.relevanceScore).toBeCloseTo(0.77, 3)
  })

  it('AC2/TC-CAT-005: 13-значный штрихкод, НЕ существующий в medicines.barcode → data:[], без текстового фолбэка', async () => {
    // Медикамент с ПОХОЖИМ текстом существует — если бы фолбэк на текстовый поиск сработал,
    // тест поймал бы это как ложный положительный результат.
    await seedMedicine({ id: '10000000-0000-4000-8000-000000000002', tradeName: '4870123456789', innName: 'X' })

    const result = await provider.search(baseSearchQuery({ text: '9999999999999' }))

    expect(result).toEqual({ items: [], nextCursor: null, hasMore: false })
  })

  it('TC-CAT-004: точный штрихкод найден через searchByBarcode()', async () => {
    const medicineId = '10000000-0000-4000-8000-000000000003'
    const barcode = '4870123456780'
    await seedMedicine({ id: medicineId, tradeName: 'Штрих-товар', innName: 'X', barcode })
    await seedOffer({ medicineId, priceDiram: 500 })

    const result = await provider.searchByBarcode(barcode, TenantId.from(NEUTRAL_TENANT_ID))

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.medicineId).toBe(medicineId)
  })

  it('AC3/SRS-CAT-055: control_category=narcotic исключён из результатов ни при каких условиях', async () => {
    const medicineId = '10000000-0000-4000-8000-000000000004'
    await seedMedicine({ id: medicineId, tradeName: 'Морфин', innName: 'Морфин', controlCategory: 'narcotic' })
    await seedOffer({ medicineId, priceDiram: 1000 })

    const result = await provider.search(baseSearchQuery({ text: 'морфин' }))

    expect(result.items).toHaveLength(0)
  })

  it('AC5/TC-CAT-019: pharmacy_chains.status=suspended для единственной несущей товар сети → товар НЕ в результатах', async () => {
    const medicineId = '10000000-0000-4000-8000-000000000005'
    await seedMedicine({ id: medicineId, tradeName: 'Суспендин', innName: 'X' })
    await seedOffer({ medicineId, priceDiram: 800 })
    await pool.query(`UPDATE pharmacy_chains SET status = 'suspended' WHERE id = $1`, [CHAIN_ID])

    const result = await provider.search(baseSearchQuery({ text: 'суспендин' }))

    expect(result.items).toHaveLength(0)
  })

  it('AC4/TC-CAT-025/SRS-CAT-075: statement_timeout превышен → SearchTemporarilyDegradedError, НЕ generic 500', async () => {
    const impatientProvider = new PostgresSearchProvider(
      db,
      pino({ enabled: false }),
      { now: () => new Date() },
      { searchQueryTimeoutMs: 1 } as ConstructorParameters<typeof PostgresSearchProvider>[3], // 1мс — гарантированно меньше времени выполнения любого реального запроса
    )
    await seedMedicine({ id: '10000000-0000-4000-8000-000000000006', tradeName: 'Таймаутин', innName: 'X' })

    await expect(impatientProvider.search(baseSearchQuery({ text: 'таймаутин' }))).rejects.toThrow(
      SearchTemporarilyDegradedError,
    )
  })

  it('TC-CAT-017/SRS-CAT-077: нет совпадений → 200-совместимая пустая страница, не исключение', async () => {
    const result = await provider.search(baseSearchQuery({ text: 'несуществующий-препарат-xyz' }))
    expect(result).toEqual({ items: [], nextCursor: null, hasMore: false })
  })

  it('TC-CAT-003 (частично): geo не передан → proximityScore не участвует, товар без гео всё равно найден', async () => {
    const medicineId = '10000000-0000-4000-8000-000000000007'
    await seedMedicine({ id: medicineId, tradeName: 'Безгеотин', innName: 'X' })
    await seedOffer({ medicineId, priceDiram: 300 })

    const result = await provider.search(baseSearchQuery({ text: 'безгеотин' }))

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.cheapestOffer?.distanceMeters).toBeNull()
  })
})
