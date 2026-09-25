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
 * **AC1 (TC-CAT-002/SRS-CAT-020)**: спецификация (`20-module-catalog-search.md` §3.2) приводит
 * пример с `similarity('Цитрамон','цытрамон')=0.62` и итоговым `finalScore=0.770` как
 * ИЛЛЮСТРАЦИЮ формулы, а не как гарантированную константу окружения — `similarity()` зависит от
 * версии `pg_trgm`. На фактической версии этого окружения (PostgreSQL 16.15,
 * Debian 16.15-1.pgdg13+2) `similarity('Цитрамон','цытрамон')=0.5`, не `0.62`, поэтому литеральные
 * `0.770` НЕ воспроизводимы здесь и тест их не проверяет. Вместо этого тест запрашивает
 * `similarity()` напрямую у ТОЙ ЖЕ БД в рантайме и считает ожидаемый `finalScore` по формуле
 * `SRS-CAT-018/019` (веса + нормализация `RankingScoreMapper`) из этого живого значения и
 * остальных компонент фикстуры (AC1: 4 аптеки в радиусе → `availability` насыщена до `1.0`,
 * 800м из 5000м радиуса → `proximity`, единственный медикамент на странице → `price=1.0`
 * (вырожденный случай), `reliability=4.2/5`). Так тест проверяет саму формулу ранжирования,
 * а не конкретный релиз `pg_trgm`.
 *
 * **Окружение**: см. JSDoc `postgres-search-suggest.adapter.integration.spec.ts` — тот же
 * `describe.skipIf`, честный skip при недоступном Postgres (не «зелёный по умолчанию»).
 *
 * **ИСПРАВЛЕНО (гейт CI)**: `migrate()` вызывался под ролью `test` — когда реальные миграции
 * уже применены `dorutj_migrator` (см. `infra/docker/postgres-init/01-test-database.sql` →
 * `pnpm db:migrate` → `test:integration`, точный порядок CI), схема бухгалтерии `drizzle`
 * УЖЕ существует и принадлежит `dorutj_migrator` — `test` не имеет прав писать в неё,
 * `migrate()` падает `permission denied for schema drizzle`. `migrate()` теперь идёт под
 * ОТДЕЛЬНЫМ `migratorPool` (идемпотентно — при уже применённых миграциях это no-op, drizzle
 * сверяется со своей бухгалтерией); `db`/`pool` (роль `test`) остаются для самого теста —
 * тот же приём, что `i18n-overrides-catalog.seed.integration.spec.ts`.
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
import { TRIGRAM_SIMILARITY_FLOOR } from '@/modules/catalog/infrastructure/adapters/postgres-search.sql.js'
import {
  AVAILABILITY_SATURATION_OFFERS,
  RANKING_WEIGHT_AVAILABILITY,
  RANKING_WEIGHT_PRICE,
  RANKING_WEIGHT_PROXIMITY,
  RANKING_WEIGHT_RELIABILITY,
  RANKING_WEIGHT_TEXT,
  RELIABILITY_SCALE_MAX,
} from '@/modules/catalog/domain/services/ranking-score-mapper.service.js'
import type { SearchQuery } from '@/modules/catalog/application/search/ports/search-provider.port.js'

const TEST_DATABASE_URL =
  process.env.CATALOG_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

/** DDL (`migrate()`) — под ролью-владельцем `dorutj_migrator` (см. блок «ИСПРАВЛЕНО» выше). */
const MIGRATOR_DATABASE_URL = process.env.CATALOG_MIGRATOR_DATABASE_URL ?? buildMigratorUrl(TEST_DATABASE_URL)

function buildMigratorUrl(appUrl: string): string {
  try {
    const url = new URL(appUrl)
    url.username = 'dorutj_migrator'
    // Дев-дефолт, коммитится в открытом виде (правило 13 AGENTS.md), не секрет.
    url.password = 'dorutj_dev_only_password'
    return url.toString()
  } catch {
    return appUrl
  }
}

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
const migratorAvailable = postgresAvailable && (await isPostgresReachable(MIGRATOR_DATABASE_URL))

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

describe.skipIf(!postgresAvailable || !migratorAvailable)('PostgresSearchProvider.search() — integration (DTJ-185)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let migratorPool: Pool
  let provider: PostgresSearchProvider

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    migratorPool = new Pool({ connectionString: MIGRATOR_DATABASE_URL })
    // DDL — под ролью-владельцем `dorutj_migrator` (см. блок «ИСПРАВЛЕНО» в шапке файла).
    await migrate(drizzle(migratorPool), { migrationsFolder: MIGRATIONS_DIR })
    const logger = pino({ enabled: false })
    provider = new PostgresSearchProvider(
      db,
      logger,
      { now: () => new Date() },
      { searchQueryTimeoutMs: 2_000 } as ConstructorParameters<typeof PostgresSearchProvider>[3],
    )
  })

  afterAll(async () => {
    await migratorPool.end().catch(() => undefined)
    await pool.end().catch(() => undefined)
  })

  async function truncateAll(): Promise<void> {
    // `RESTART IDENTITY` требует владения соответствующими sequence — `test` им не владеет
    // (см. блок «ИСПРАВЛЕНО» в шапке файла) — под `migratorPool`, как и остальной DDL/admin-DML.
    await migratorPool.query(
      'TRUNCATE pharmacy_reliability_scores, pharmacy_inventory, pharmacies, pharmacy_chains, tenants, medicine_substances, medicines, categories RESTART IDENTITY CASCADE',
    )
  }

  async function seedBaseFixtures(): Promise<void> {
    await pool.query(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('root', 'Корень', 'Root', 'Root', 'otc', 0, true)`,
    )
    // Ж13: `TRUNCATE ... tenants ... CASCADE` в truncateAll() сносит и `tenant_settings`
    // (FK на tenants.id) — восстанавливаем ОБЕ строки, иначе `tenantFromDb` считает
    // нейтрального тенанта неконсистентным (null) и ЛЮБОЙ анонимный запрос к общей БД
    // после этого файла получает 500 «neutral tenant not configured». Значения — 1:1 из
    // `migrations/0021_seed_neutral_tenant.sql`, тем же id, чтобы не конфликтовать с ней.
    await pool.query(
      `INSERT INTO tenants (id, slug, is_neutral, courier_sourcing_mode, custom_domain_status)
       VALUES ($1, 'neutral', true, 'platform_pool', 'none')`,
      [NEUTRAL_TENANT_ID],
    )
    await pool.query(
      `INSERT INTO tenant_settings (
         tenant_id, brand_name, brand_palette, default_locale,
         cod_limit_diram, hold_period_days, pickup_sla_minutes, pickup_sla_buffer_minutes,
         delivery_sla_city_minutes, delivery_sla_remote_minutes, dispute_window_hours,
         inventory_delta_sla_minutes, return_restock_min_remaining_days
       )
       VALUES (
         $1, 'DoruTJ', '{
           "--brand-primary": "#64748b",
           "--brand-primary-hover": "#475569",
           "--brand-secondary": "#94a3b8",
           "--brand-accent": "#0ea5e9",
           "--brand-bg": "#ffffff",
           "--brand-surface": "#f8fafc",
           "--brand-text": "#0f172a",
           "--brand-text-muted": "#64748b",
           "--brand-border": "#e2e8f0",
           "--brand-success": "#16a34a",
           "--brand-danger": "#dc2626",
           "--brand-warning": "#d97706",
           "--brand-radius": "8px",
           "--brand-font-family": "system-ui, sans-serif"
         }', 'tj',
         50000, 1, 7, 5,
         240, 1440, 24,
         5, 30
       )`,
      [NEUTRAL_TENANT_ID],
    )
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

  it('AC1/TC-CAT-002/SRS-CAT-020: опечатка «цытрамон» находит «Цитрамон», finalScore по формуле ранжирования из живой similarity', async () => {
    const medicineId = '10000000-0000-4000-8000-000000000001'
    const cheapestPharmacyId = PHARMACY_ID
    // AC1 дословно: «4 аптеки в радиусе на 800 м» — offersCountInRadius=4 обязано насытить
    // availability до 1.0 (AVAILABILITY_SATURATION_OFFERS=3). Прежняя фикстура создавала РОВНО
    // ОДИН оффер — дефект фикстуры (availability=1/3), а не кода ранжирования (разбор CTO).
    const extraPharmacyIds = [
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012',
    ]
    await seedMedicine({ id: medicineId, tradeName: 'Цитрамон', innName: 'Ацетилсалициловая кислота' })

    // Все 4 аптеки — в той же геоточке, что и исходная CENTER-аптека (~800м от geo-запроса ниже),
    // поэтому nearestOfferDistanceMeters (MIN по всем офферам) остаётся 800м независимо от того,
    // сколько их — proximityScore не меняется добавлением дополнительных аптек.
    for (const pharmacyId of extraPharmacyIds) {
      await pool.query(
        `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
         VALUES ($1, $2, 'Аптека доп.', 'ул. Тестовая доп.', $3, $4, '+992900000001', 'active')`,
        [pharmacyId, CHAIN_ID, CENTER.lat, CENTER.lon],
      )
    }

    // AC1: цена самого дешёвого оффера — 12.00 TJS (1200 диram), reliability его аптеки — 4.2/5.
    // У трёх дополнительных аптек цена заведомо выше 1200, чтобы ARRAY_AGG(... ORDER BY price ASC)
    // однозначно (без гонки на равных ценах) выбрал cheapestPharmacyId «самым дешёвым» оффером.
    await seedOffer({ medicineId, pharmacyId: cheapestPharmacyId, priceDiram: 1200 })
    await seedReliability(cheapestPharmacyId, 4.2)
    for (const pharmacyId of extraPharmacyIds) {
      await seedOffer({ medicineId, pharmacyId, priceDiram: 1500 })
    }

    const geo = GeoPoint.create(CENTER.lat + 0.0072, CENTER.lon) // ~800м к северу
    if (!geo.ok) throw new Error('fixture GeoPoint invalid')

    // Живая similarity ИЗ ЭТОЙ ЖЕ БД (см. JSDoc файла — версия pg_trgm меняет это число, спека
    // приводит его лишь как иллюстрацию формулы). Тест считает ожидаемый finalScore из НЕЁ, а не
    // из литерала спецификации.
    const similarityProbe = await pool.query<{ sim: number }>(
      `SELECT similarity('Цитрамон', 'цытрамон')::real AS sim`,
    )
    const similarity = similarityProbe.rows[0]?.sim
    if (similarity === undefined) throw new Error('similarity probe returned no rows')

    // SRS-CAT-019 п.3: clamp((similarity - floor) / (1 - floor), 0, 1). AC1 «без tsvector-хита» —
    // весовые CASE-компоненты (A/C) не срабатывают, textRelevance определяется триграммой trade_name.
    const textRelevance = Math.min(
      Math.max((similarity - TRIGRAM_SIMILARITY_FLOOR) / (1 - TRIGRAM_SIMILARITY_FLOOR), 0),
      1,
    )
    const availability = Math.min(4 / AVAILABILITY_SATURATION_OFFERS, 1) // AC1: 4 аптеки → насыщение
    const proximity = 1 - Math.min(800 / 5000, 1) // AC1: 800м из радиуса 5000м
    const price = 1 // единственный медикамент на странице → вырожденный случай computePriceScore
    const reliability = 4.2 / RELIABILITY_SCALE_MAX // AC1: reliability самой дешёвой аптеки

    const expectedFinalScore =
      RANKING_WEIGHT_TEXT * textRelevance +
      RANKING_WEIGHT_AVAILABILITY * availability +
      RANKING_WEIGHT_PROXIMITY * proximity +
      RANKING_WEIGHT_PRICE * price +
      RANKING_WEIGHT_RELIABILITY * reliability

    const result = await provider.search(
      baseSearchQuery({ text: 'цытрамон', geo: geo.value, radiusMeters: 5000 }),
    )

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.tradeName).toBe('Цитрамон')
    expect(result.items[0]?.relevanceScore).toBeCloseTo(expectedFinalScore, 3)
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
