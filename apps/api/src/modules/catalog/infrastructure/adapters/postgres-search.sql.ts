/**
 * SQL-строитель `PostgresSearchProvider.search()`/`searchByBarcode()` (DTJ-185, EP-06, R1,
 * `SRS-CAT-013..015, 018-024, 044-048, 055-056, 075, 077`). Отдельный файл от
 * `postgres-search.adapter.ts` (тот же приём, что `postgres-suggest.sql.ts`, C2).
 *
 * **Без ручных SQL-алиасов для Drizzle-таблиц** (приём `postgres-pharmacy-map.adapter.ts`,
 * DTJ-195): `${medicines.id}` рендерится как `"medicines"."id"`; алиас в `FROM` (`m`) сделал бы
 * эту ссылку синтаксической ошибкой Postgres («invalid reference to FROM-clause entry»). Алиасы
 * `c`/`a` — ТОЛЬКО для CTE (`candidates`/`aggregated`), у них нет объекта схемы и нет конфликта.
 *
 * **Три документированных отклонения от буквального текста спеки/тикета (детали — отчёт сдачи):**
 * 1. **Геофильтр — гаверсинус на `latitude`/`longitude`, не `ST_DWithin`/PostGIS.**
 *    `pharmacies.geo_point`/`postgis` отсутствуют в фактических миграциях (тот же вывод, что
 *    `postgres-pharmacy-map.adapter.ts` DTJ-195 п.1). Формула = `GeoPoint.distanceTo()`
 *    (`shared-kernel`), `EARTH_RADIUS_METERS` совпадает с VO. `ix_pharmacies_geo_point` (GiST)
 *    тоже не существует — Seq/Index Scan на `pharmacies` по выражению, приемлемо на объёме
 *    таблицы аптек, НЕ на `medicines`/`pharmacy_inventory`, где индексы ниже реально работают.
 * 2. **`tajik_ru` создана этой миграцией как `COPY = russian`, БЕЗ словаря `tajik_unaccent`**
 *    (`SRS-DB-014`) — файл словаря требует Docker-образ, недостижим из миграции. Поведение сейчас
 *    идентично `'russian'`; `medicines.search_vector` тоже остался на `to_tsvector('russian', ...)`
 *    (владение — DTJ-091, не этот тикет).
 * 3. **q1/q2 (транслит, `SRS-CAT-024` п.3) НЕ реализован.** Порт `SearchQuery.text` (DTJ-180,
 *    форма зафиксирована) несёт одну строку; загрузчик `translit-map.json` назначен DTJ-188
 *    (JSDoc `query-normalization.service.ts`). Штрихкод — та же ситуация, но `search()`
 *    детектирует его форму сам (`isBarcodeShaped`), обороняясь независимо от маршрутизации
 *    DTJ-188. TC-CAT-007 вне тест-плана DTJ-185.
 *
 * **Текстовая релевантность (`SRS-CAT-019`).** Явный `CASE` на `manufacturer_name` вместо
 * `ts_rank_cd` (тикет: «заменить плейсхолдер веса C РЕАЛЬНЫМ... явный CASE»): весовая колонка A
 * (`trade_name`/`inn_name`) пересобирается ad hoc только для уже отфильтрованных строк (не влияет
 * на выбор индекса), сравнивается `GREATEST` с базовым 0.7 (полный `search_vector`) и триграммой.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-013..026, 044-048, 055-056, 075, 077)
 * @see docs/spec/11-database-schema.md (SRS-DB-014..019, готовый запрос №1)
 * @see tickets/ep05-search-map/DTJ-185.md
 */
import { sql, type SQL } from 'drizzle-orm'
import { medicines } from '@/db/schema/medicines.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { pharmacyChains } from '@/db/schema/pharmacy-chains.js'
import { tenants } from '@/db/schema/tenants.js'
import { pharmacyReliabilityScores } from '@/db/schema/pharmacy-reliability-scores.schema.js'
import { buildMedicinesVisibilityCondition } from './postgres-suggest.sql.js'

/** SRS-DB-017: порог `pg_trgm.similarity_threshold` сессии (см. `drizzle.provider.ts` pool-хук). */
export const TRIGRAM_SIMILARITY_FLOOR = 0.2
/** SRS-CAT-019 п.3: `[порог..1.0]` растягивается в `[0,1]` делением на этот диапазон. */
const TRIGRAM_SIMILARITY_RANGE = 1 - TRIGRAM_SIMILARITY_FLOOR
/** SRS-CAT-019 п.1: точное совпадение по весу A (`trade_name`/`inn_name`). */
const TEXT_RELEVANCE_WEIGHT_A = 1.0
/** SRS-CAT-019 п.2: совпадение ТОЛЬКО по весу C (`manufacturer_name`). */
const TEXT_RELEVANCE_WEIGHT_C = 0.7
/** SRS-CAT-023: браузинг категории без текста — релевантность не различает кандидатов. */
export const FORCED_TEXT_RELEVANCE_FOR_BROWSING = 1.0
const RELEVANCE_FLOOR = 0
const RELEVANCE_CEILING = 1
/** См. п.2 JSDoc файла — частичная реализация SRS-DB-014/015 (`COPY = russian`, миграция DTJ-185). */
export const SEARCH_TS_CONFIG = 'tajik_ru'
/** SRS-CAT-018/§14.1: дефолт надёжности для аптеки без данных/офферов у этого медикамента. */
export const DEFAULT_RELIABILITY_SCORE = 3.5
/** Совпадает с `EARTH_RADIUS_METERS` в `GeoPoint.distanceTo()` — см. п.1 JSDoc файла. */
const EARTH_RADIUS_METERS = 6_371_000
/** SRS-CAT-024 п.2: штрихкод — строка из цифр длиной 8 либо 12-14 (зеркалит `QueryNormalizationService`). */
const BARCODE_PATTERN = /^\d{8}$|^\d{12,14}$/u
/** `searchByBarcode()`: `barcode` уникален (`ux_medicines_barcode`) — максимум одна запись. */
const BARCODE_RESULT_LIMIT = 1

export interface SearchGeoParams {
  readonly lat: number
  readonly lon: number
  readonly radiusMeters: number
}

export interface SearchFiltersParams {
  readonly categoryId?: number
  readonly inStockOnly: boolean
  readonly openNowOnly: boolean
  readonly is24x7Only: boolean
  readonly priceMinDiram?: number
  readonly priceMaxDiram?: number
  readonly manufacturerName?: string
  readonly isPrescriptionRequired?: boolean
}

export type SearchCandidatesMode =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'browsing' }

export interface SearchQueryParams {
  readonly tenantId: string
  readonly geo?: SearchGeoParams | undefined
  readonly filters: SearchFiltersParams
  /** `HH:MM:SS` в `Asia/Dushanbe` — обязателен, только если `filters.openNowOnly`. */
  readonly nowTimeOfDay?: string | undefined
  readonly sort: 'relevance' | 'price_asc' | 'price_desc' | 'distance_asc'
  readonly limit: number
  readonly offset: number
}

/** Сырая строка результата `search()`/`searchByBarcode()` (snake_case, см. JSDoc `postgres-suggest.sql.ts`). */
export interface SearchQueryRow {
  readonly id: string
  readonly trade_name: string
  readonly inn_name: string
  readonly dosage_form: string
  readonly dosage_strength: string
  readonly image_url: string | null
  readonly is_prescription_required: boolean
  readonly control_category: string
  readonly text_relevance: number
  readonly offers_count: number
  readonly min_price: number | null
  readonly nearest_distance: number | null
  readonly cheapest_pharmacy_id: string | null
  readonly cheapest_pharmacy_name: string | null
  readonly cheapest_quantity: number | null
  readonly cheapest_updated_at: string | Date | null
  readonly cheapest_reliability: number
}

/** SRS-CAT-024 п.2: `search()` детектирует штрихкод-форму сам (см. п.3 JSDoc файла). */
export function isBarcodeShaped(text: string): boolean {
  return BARCODE_PATTERN.test(text)
}

// ─── Фрагменты: видимость, tenant-скоуп, гео, время работы ────────────────────────────

/** SRS-CAT-055 первый рубеж + доп. фильтры candidates. Переиспользует `postgres-suggest.sql.ts` (Ж12). */
function buildCandidatesFilterFragment(filters: SearchFiltersParams): SQL {
  return sql`${buildMedicinesVisibilityCondition()}
    ${filters.categoryId === undefined ? sql`` : sql`AND ${medicines.categoryId} = ${filters.categoryId}`}
    ${
      filters.isPrescriptionRequired === undefined
        ? sql``
        : sql`AND ${medicines.isPrescriptionRequired} = ${filters.isPrescriptionRequired}`
    }
    ${
      filters.manufacturerName === undefined
        ? sql``
        : sql`AND lower(${medicines.manufacturerName}) = lower(${filters.manufacturerName})`
    }`
}

/** SRS-CAT-010 п.3 + White-Label/нейтральный tenant-скоуп — дословно зеркалит `postgres-pharmacy-map.adapter.ts` (DTJ-195). */
function visibilityAndTenantScopeFragment(): SQL {
  return sql`${pharmacies.status} = 'active' AND ${pharmacyChains.status} IN ('approved', 'active')
    AND (${pharmacyChains.tenantId} = ${tenants.id} OR (${tenants.isNeutral} AND ${pharmacyChains.tenantId} IS NULL))`
}

/** Гаверсинус в метрах — см. п.1 JSDoc файла (нет PostGIS). `NULL`, если `geo` не передан. */
function distanceExprFragment(geo: SearchGeoParams | undefined): SQL {
  if (geo === undefined) {
    return sql`NULL::double precision`
  }
  return sql`(
    ${2 * EARTH_RADIUS_METERS} * asin(sqrt(
      power(sin(radians((${geo.lat}::double precision - ${pharmacies.latitude}::double precision)) / 2), 2) +
      cos(radians(${pharmacies.latitude}::double precision)) * cos(radians(${geo.lat}::double precision)) *
      power(sin(radians((${geo.lon}::double precision - ${pharmacies.longitude}::double precision)) / 2), 2)
    ))
  )`
}

/** SRS-CAT-046: интервал через полночь. `nowTimeOfDay` — уже вычислен вызывающим (Ж8, порт Clock). */
function openNowConditionFragment(nowTimeOfDay: string): SQL {
  return sql`(
    ${pharmacies.is24_7} = true
    OR (
      ${pharmacies.openingTime} IS NOT NULL AND ${pharmacies.closingTime} IS NOT NULL AND (
        (${pharmacies.closingTime} >= ${pharmacies.openingTime} AND ${nowTimeOfDay}::time BETWEEN ${pharmacies.openingTime} AND ${pharmacies.closingTime})
        OR (${pharmacies.closingTime} < ${pharmacies.openingTime} AND (${nowTimeOfDay}::time >= ${pharmacies.openingTime} OR ${nowTimeOfDay}::time <= ${pharmacies.closingTime}))
      )
    )
  )`
}

/** SRS-CAT-044/045/046/047 + гео-радиус — все опциональные условия `offers`. */
function buildOffersFilterFragment(params: SearchQueryParams): SQL {
  const { filters, geo, nowTimeOfDay } = params
  return sql`
    ${geo === undefined ? sql`` : sql`AND ${distanceExprFragment(geo)} <= ${geo.radiusMeters}`}
    ${filters.priceMinDiram === undefined ? sql`` : sql`AND ${pharmacyInventory.price} >= ${filters.priceMinDiram}`}
    ${filters.priceMaxDiram === undefined ? sql`` : sql`AND ${pharmacyInventory.price} <= ${filters.priceMaxDiram}`}
    ${filters.is24x7Only ? sql`AND ${pharmacies.is24_7} = true` : sql``}
    ${
      filters.openNowOnly && nowTimeOfDay !== undefined
        ? sql`AND ${openNowConditionFragment(nowTimeOfDay)}`
        : sql``
    }
  `
}

// ─── Текстовая релевантность (SRS-CAT-019) ─────────────────────────────────────────────

/** `clamp((similarity - floor) / range, 0, 1)` — SRS-CAT-019 п.3. */
function trigramRelevanceExpr(column: typeof medicines.tradeName | typeof medicines.innName, text: string): SQL {
  return sql`LEAST(GREATEST((similarity(${column}, ${text}) - ${TRIGRAM_SIMILARITY_FLOOR}) / ${TRIGRAM_SIMILARITY_RANGE}, ${RELEVANCE_FLOOR}), ${RELEVANCE_CEILING})`
}

/** GREATEST(весA, весC-если-не-A, триграмма×2) — см. п. «Текстовая релевантность» JSDoc файла. */
function textRelevanceExpr(text: string): SQL {
  const weightAVector = sql`(to_tsvector(${SEARCH_TS_CONFIG}, unaccent(coalesce(${medicines.tradeName}, ''))) || to_tsvector(${SEARCH_TS_CONFIG}, unaccent(coalesce(${medicines.innName}, ''))))`
  return sql`GREATEST(
    CASE WHEN ${weightAVector} @@ plainto_tsquery(${SEARCH_TS_CONFIG}, ${text}) THEN ${TEXT_RELEVANCE_WEIGHT_A} ELSE ${RELEVANCE_FLOOR} END,
    CASE WHEN ${medicines.searchVector} @@ plainto_tsquery(${SEARCH_TS_CONFIG}, ${text}) THEN ${TEXT_RELEVANCE_WEIGHT_C} ELSE ${RELEVANCE_FLOOR} END,
    ${trigramRelevanceExpr(medicines.tradeName, text)},
    ${trigramRelevanceExpr(medicines.innName, text)}
  )`
}

/** Общий список колонок `candidates` для всех трёх режимов (C15 DRY) — `text_relevance` добавляет вызывающий. */
const CANDIDATE_BASE_COLUMNS = sql`${medicines.id} AS id, ${medicines.tradeName} AS trade_name, ${medicines.innName} AS inn_name,
  ${medicines.dosageForm} AS dosage_form, ${medicines.dosageStrength} AS dosage_strength,
  ${medicines.imageUrl} AS image_url, ${medicines.isPrescriptionRequired} AS is_prescription_required,
  ${medicines.controlCategory} AS control_category`

/** Кандидаты: текстовый режим (`SRS-CAT-024` п.4) — три способа объединены OR (WHERE использует индексы). */
function buildTextCandidatesQuery(text: string, filters: SearchFiltersParams): SQL {
  return sql`
    SELECT ${CANDIDATE_BASE_COLUMNS}, ${textRelevanceExpr(text)} AS text_relevance
    FROM ${medicines}
    WHERE ${buildCandidatesFilterFragment(filters)}
      AND (
        ${medicines.searchVector} @@ plainto_tsquery(${SEARCH_TS_CONFIG}, ${text})
        OR ${medicines.tradeName} % ${text}
        OR ${medicines.innName} % ${text}
      )
  `
}

/** Кандидаты: браузинг категории без текста (`SRS-CAT-023`) — релевантность форсирована. */
function buildBrowsingCandidatesQuery(filters: SearchFiltersParams): SQL {
  return sql`
    SELECT ${CANDIDATE_BASE_COLUMNS}, ${FORCED_TEXT_RELEVANCE_FOR_BROWSING}::double precision AS text_relevance
    FROM ${medicines}
    WHERE ${buildCandidatesFilterFragment(filters)}
  `
}

/** Кандидаты: точный штрихкод (`SRS-CAT-024` п.2, `TC-CAT-004/005`) — без фолбэка на текст. */
function buildBarcodeCandidatesQuery(barcode: string): SQL {
  return sql`
    SELECT ${CANDIDATE_BASE_COLUMNS}, ${TEXT_RELEVANCE_WEIGHT_A}::double precision AS text_relevance
    FROM ${medicines}
    WHERE ${buildMedicinesVisibilityCondition()} AND ${medicines.barcode} = ${barcode}
  `
}

// ─── offers / aggregated (общие для всех веток candidates) — CTE-алиасы c/a, см. JSDoc файла ──

/** `offers`: одна строка = один квалифицирующий оффер (SRS-CAT-010 п.2/3, наличие, гео, время работы, tenant). */
function buildOffersCte(params: SearchQueryParams): SQL {
  return sql`
    offers AS (
      SELECT c.id AS medicine_id, ${pharmacyInventory.pharmacyId} AS pharmacy_id, ${pharmacies.name} AS pharmacy_name,
             ${pharmacyInventory.price} AS price, ${pharmacyInventory.quantity} AS quantity,
             ${pharmacyInventory.updatedAt} AS updated_at, ${distanceExprFragment(params.geo)} AS distance_m,
             COALESCE(${pharmacyReliabilityScores.score}::double precision, ${DEFAULT_RELIABILITY_SCORE}) AS reliability_score
      FROM candidates c
      JOIN ${pharmacyInventory} ON ${pharmacyInventory.medicineId} = c.id AND ${pharmacyInventory.quantity} > 0
      JOIN ${pharmacies} ON ${pharmacies.id} = ${pharmacyInventory.pharmacyId}
      JOIN ${pharmacyChains} ON ${pharmacyChains.id} = ${pharmacies.chainId}
      JOIN ${tenants} ON ${tenants.id} = ${params.tenantId}::uuid
      LEFT JOIN ${pharmacyReliabilityScores} ON ${pharmacyReliabilityScores.pharmacyId} = ${pharmacies.id}
      WHERE ${visibilityAndTenantScopeFragment()}
        ${buildOffersFilterFragment(params)}
    )
  `
}

/** `aggregated`: `COUNT`/`MIN` + «дешевле-первая» проекция через `ARRAY_AGG` (зеркалит спеку §3.3). */
const AGGREGATED_CTE = sql`
  aggregated AS (
    SELECT medicine_id,
           COUNT(*) AS offers_count,
           MIN(price) AS min_price,
           MIN(distance_m) AS nearest_distance,
           (ARRAY_AGG(pharmacy_id ORDER BY price ASC))[1] AS cheapest_pharmacy_id,
           (ARRAY_AGG(pharmacy_name ORDER BY price ASC))[1] AS cheapest_pharmacy_name,
           (ARRAY_AGG(quantity ORDER BY price ASC))[1] AS cheapest_quantity,
           (ARRAY_AGG(updated_at ORDER BY price ASC))[1] AS cheapest_updated_at,
           (ARRAY_AGG(reliability_score ORDER BY price ASC))[1] AS cheapest_reliability
    FROM offers GROUP BY medicine_id
  )
`

const SELECT_RESULT_COLUMNS = sql`
  SELECT c.id, c.trade_name, c.inn_name, c.dosage_form, c.dosage_strength, c.image_url,
         c.is_prescription_required, c.control_category, c.text_relevance,
         COALESCE(a.offers_count, 0)::int AS offers_count, a.min_price, a.nearest_distance,
         a.cheapest_pharmacy_id, a.cheapest_pharmacy_name, a.cheapest_quantity, a.cheapest_updated_at,
         COALESCE(a.cheapest_reliability, ${DEFAULT_RELIABILITY_SCORE}) AS cheapest_reliability
  FROM candidates c
`

function sortOrderFragment(sort: SearchQueryParams['sort']): SQL {
  switch (sort) {
    case 'price_asc':
      return sql`a.min_price ASC NULLS LAST, c.id ASC`
    case 'price_desc':
      return sql`a.min_price DESC NULLS LAST, c.id ASC`
    case 'distance_asc':
      return sql`a.nearest_distance ASC NULLS LAST, c.id ASC`
    case 'relevance':
    default:
      return sql`c.text_relevance DESC, c.id ASC`
  }
}

/** SRS-CAT-045: `inStockOnly=true` → медикамент без реального оффера исчезает (INNER, не LEFT). */
function aggregatedJoinFragment(inStockOnly: boolean): SQL {
  return inStockOnly
    ? sql`JOIN aggregated a ON a.medicine_id = c.id`
    : sql`LEFT JOIN aggregated a ON a.medicine_id = c.id`
}

/** Полный запрос `search()` (текст ИЛИ браузинг) — CTE `candidates`→`offers`→`aggregated`, пагинация LIMIT/OFFSET. */
export function buildSearchQuery(mode: SearchCandidatesMode, params: SearchQueryParams): SQL {
  const candidatesSql = mode.kind === 'text' ? buildTextCandidatesQuery(mode.text, params.filters) : buildBrowsingCandidatesQuery(params.filters)
  return sql`
    WITH candidates AS (${candidatesSql}),
    ${buildOffersCte(params)},
    ${AGGREGATED_CTE}
    ${SELECT_RESULT_COLUMNS}
    ${aggregatedJoinFragment(params.filters.inStockOnly)}
    ORDER BY ${sortOrderFragment(params.sort)}
    LIMIT ${params.limit} OFFSET ${params.offset}
  `
}

/** `searchByBarcode()` — точное совпадение, максимум одна запись (`barcode` уникален), без пагинации. */
export function buildBarcodeSearchQuery(barcode: string, params: Omit<SearchQueryParams, 'sort' | 'limit' | 'offset'>): SQL {
  return sql`
    WITH candidates AS (${buildBarcodeCandidatesQuery(barcode)}),
    ${buildOffersCte({ ...params, sort: 'relevance', limit: BARCODE_RESULT_LIMIT, offset: 0 })},
    ${AGGREGATED_CTE}
    ${SELECT_RESULT_COLUMNS}
    LEFT JOIN aggregated a ON a.medicine_id = c.id
    LIMIT ${BARCODE_RESULT_LIMIT}
  `
}
