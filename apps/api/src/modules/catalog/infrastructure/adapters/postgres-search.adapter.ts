/**
 * `PostgresSearchProvider` — Drizzle-реализация `SearchProvider` (EP-06, R1).
 *
 * **Файл СОВМЕСТНО владеется DTJ-185 (`search()`/`searchByBarcode()`, `SRS-CAT-013..015`,
 * ЭТОТ тикет) и DTJ-186 (`suggest()`, `SRS-CAT-027..029`, реализован раньше — см. историю
 * владения ниже).** Пересечение `files_owned` зафиксировано ОБОИМИ тикетами как известный
 * дефект планирования (`03-ARCHITECT-DECISIONS.md` D-27 §3) — практическое разрешение то же,
 * что применил DTJ-186: минимально инвазивная, обратимая правка своей части, `suggest()` не
 * тронут.
 *
 * **`search()`/`searchByBarcode()` — SRS-CAT-013..015, 018-024, 044-048, 055-056, 075, 077.**
 * SQL вынесен в `postgres-search.sql.ts` (C2). Оркестрация здесь: клампинг `limit`, cursor↔offset,
 * `SET LOCAL statement_timeout` per-route (транзакция, НЕ пул целиком — `SRS-CAT-075`), перехват
 * `57014 query_canceled` → `SearchTemporarilyDegradedError`, вызов `RankingScoreMapper` (DTJ-183)
 * для `sort='relevance'` (для остальных `sort` — композитная формула минуется целиком, тикет
 * п.3), маппинг строки → `SearchResultItem` (+ `isPromotable`, тикет п.9, осознанное расширение
 * порта ЛОКАЛЬНО в адаптере). Три документированных отклонения спецификации — см. JSDoc
 * `postgres-search.sql.ts`.
 *
 * **DI-подключение.** `SEARCH_PROVIDER` резолвится в `PostgresSearchProvider` веткой
 * `SEARCH_DRIVER==='postgres'` (дефолт) — фабрика `infrastructure/providers/
 * search-provider.factory.ts` (новый файл, НЕ `application/search/providers/
 * null-search.provider.ts`: та фабрика — слой `application`, ему запрещено импортировать
 * `PostgresSearchProvider`, см. JSDoc обоих файлов). `catalog.module.ts` — одна правленая
 * строка импорта (вне `files_owned`, тот же минимально инвазивный приём, что `drizzle.provider.ts`).
 *
 * **`suggest()` — SRS-CAT-027..029 (DTJ-186, не тронуто).** SQL — `postgres-suggest.sql.ts`.
 * `tenantId` не используется в `suggest()` — `medicines` глобальный справочник.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-011, 013-024, 027-029, 044-048, 055-056, 075, 077)
 * @see tickets/ep05-search-map/DTJ-185.md
 * @see tickets/ep05-search-map/DTJ-186.md
 */
import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import { SEARCH_DEFAULT_RADIUS_METERS } from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { AppConfigService } from '@/config/app-config.service.js'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import type { TenantId } from '@/modules/tenancy/index.js'
import {
  RankingScoreMapper,
  type RawRankingInput,
} from '@/modules/catalog/domain/services/ranking-score-mapper.service.js'
import { SearchTemporarilyDegradedError } from '@/modules/catalog/domain/errors/search-temporarily-degraded.error.js'
import type {
  PharmacyOffer,
  SearchFilters,
  SearchProvider,
  SearchQuery,
  SearchResultItem,
  SearchResultPage,
  SuggestItem,
} from '@/modules/catalog/application/search/ports/search-provider.port.js'
import {
  buildSuggestPrefixOnlyQuery,
  buildSuggestTrigramUnionQuery,
  isSuggestShortPrefix,
  type SuggestQueryRow,
} from './postgres-suggest.sql.js'
import {
  buildBarcodeSearchQuery,
  buildSearchQuery,
  isBarcodeShaped,
  type SearchCandidatesMode,
  type SearchQueryParams,
  type SearchQueryRow,
} from './postgres-search.sql.js'

/** Нижний клампинг `limit`: `< 1` бессмысленен/невалиден для SQL (тот же приём, что `AnalogCandidatesAdapter`). */
const MIN_SUGGEST_LIMIT = 1
/** Верхняя граница — защита от патологического `limit` из ошибочного вызывающего кода (C6). */
const MAX_SUGGEST_LIMIT = 50
/** SRS-API-004: `limit` результатов поиска — `1..100`. */
const MIN_SEARCH_LIMIT = 1
const MAX_SEARCH_LIMIT = 100
/** Postgres: запрос прерван `statement_timeout` (SRS-CAT-075). */
const POSTGRES_QUERY_CANCELED_CODE = '57014'
/** Asia/Dushanbe = UTC+5 круглый год, без DST (DTJ-184/195). */
const DUSHANBE_UTC_OFFSET_HOURS = 5
const MS_PER_HOUR = 3_600_000
/**
 * SRS-API-007/§7.5: порог устаревания оффера = `INVENTORY_DELTA_SLA_MINUTES * 3`. Значение —
 * дефолт схемы `tenant_settings.inventory_delta_sla_minutes` (`tenants.ts`), а не per-tenant
 * override — фактическая выборка настройки тенанта вне бюджета этого тикета (ASSUMPTION,
 * не покрыта ни одним AC/TC DTJ-185, задокументировано в отчёте сдачи).
 */
const ASSUMED_INVENTORY_DELTA_SLA_MINUTES = 5
const STALE_THRESHOLD_MULTIPLIER = 3
const MS_PER_MINUTE = 60_000

/** `SearchResultItem`, расширенный `isPromotable` (тикет п.9 — осознанное расширение ЛОКАЛЬНО). */
type SearchResultItemWithPromotable = SearchResultItem & { readonly isPromotable: boolean }

@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  private readonly rankingMapper = new RankingScoreMapper()

  /* eslint-disable max-params -- NestJS DI: 4 провайдера в конструкторе — стандартная практика фреймворка (см. pharmacy-chains-public.controller.ts) */
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: AppConfigService,
  ) {}
  /* eslint-enable max-params */

  /**
   * `SRS-CAT-013..024`. `text` в форме штрихкода (`isBarcodeShaped`) маршрутизируется в
   * `searchByBarcode()` САМОСТОЯТЕЛЬНО (defense-in-depth — маршрутизация DTJ-188 тоже
   * существует, но не гарантирована на момент этого тикета, см. JSDoc `postgres-search.sql.ts`).
   */
  public async search(query: SearchQuery): Promise<SearchResultPage> {
    const text = query.text.trim()
    if (isBarcodeShaped(text)) {
      return this.searchByBarcode(text, query.tenantId)
    }
    const params = this.toQueryParams(query)
    const limit = clampSearchLimit(query.limit)
    const offset = decodeCursor(query.cursor)
    const mode: SearchCandidatesMode = text.length === 0 ? { kind: 'browsing' } : { kind: 'text', text }
    const sqlQuery = buildSearchQuery(mode, { ...params, limit: limit + 1, offset })
    const rows = await this.executeWithTimeout(sqlQuery, {
      tenantId: query.tenantId.value,
      radiusMeters: params.geo?.radiusMeters,
      searchDescriptor: text,
    })
    return this.toResultPage(rows, { limit, offset, params, sort: query.sort })
  }

  /**
   * `SRS-CAT-024` п.2, `TC-CAT-004/005` — точное совпадение, БЕЗ фолбэка на текстовый поиск.
   * Без `geo`/фильтров — точный код найден или нет, радиус/наличие/время работы не сужают
   * «где это вообще продаётся» (не покрыто AC этого тикета — документированное упрощение).
   */
  public async searchByBarcode(barcode: string, tenantId: TenantId): Promise<SearchResultPage> {
    const params = this.toQueryParams({ tenantId, filters: EMPTY_FILTERS, sort: 'relevance' })
    const sqlQuery = buildBarcodeSearchQuery(barcode, params)
    const rows = await this.executeWithTimeout(sqlQuery, {
      tenantId: tenantId.value,
      radiusMeters: params.geo?.radiusMeters,
      searchDescriptor: `barcode:${barcode}`,
    })
    return this.toResultPage(rows, { limit: 1, offset: 0, params, sort: 'relevance' })
  }

  /** `SRS-CAT-027..029` — см. JSDoc файла и `postgres-suggest.sql.ts` за деталями алгоритма. */
  public async suggest(
    rawPrefix: string,
    _tenantId: TenantId,
    limit: number,
  ): Promise<readonly SuggestItem[]> {
    const prefix = rawPrefix.trim()
    if (prefix.length === 0) {
      // Пустой ввод — ответственность SuggestMedicinesUseCase (DTJ-189, SRS-CAT-030,
      // client-history/trending). Адаптер защищается сам: пустая строка как LIKE-паттерн
      // совпала бы со ВСЕМ опубликованным каталогом — бессмысленный и дорогой запрос.
      return []
    }
    const effectiveLimit = clampLimit(limit)
    const query = isSuggestShortPrefix(prefix)
      ? buildSuggestPrefixOnlyQuery(prefix, effectiveLimit)
      : buildSuggestTrigramUnionQuery(prefix, effectiveLimit)
    // `SuggestQueryRow & Record<string, unknown>` — см. JSDoc типа в postgres-suggest.sql.ts
    // (границу generic-параметра `execute<T extends Record<string, unknown>>` `interface` сам
    // по себе не удовлетворяет).
    const rows = await this.db.execute<SuggestQueryRow & Record<string, unknown>>(query)
    return (extractRows(rows) as readonly SuggestQueryRow[]).map(toSuggestItem)
  }

  /** `filters.openNowOnly` требует «сейчас» в `Asia/Dushanbe` (Ж8 — через `Clock`, не `Date.now()`). */
  private toQueryParams(query: Pick<SearchQuery, 'tenantId' | 'geo' | 'radiusMeters' | 'filters' | 'sort'>): SearchQueryParams {
    const geo =
      query.geo === undefined
        ? undefined
        : { lat: query.geo.latitude, lon: query.geo.longitude, radiusMeters: query.radiusMeters ?? SEARCH_DEFAULT_RADIUS_METERS }
    return {
      tenantId: query.tenantId.value,
      geo,
      filters: query.filters,
      nowTimeOfDay: query.filters.openNowOnly ? toDushanbeTimeOfDay(this.clock.now()) : undefined,
      sort: query.sort,
      limit: MIN_SEARCH_LIMIT,
      offset: 0,
    }
  }

  /**
   * SRS-CAT-075: `SET LOCAL statement_timeout` в транзакции (per-route, НЕ глобальный пул —
   * `pg_trgm.similarity_threshold`, наоборот, глобальный пул-хук, `drizzle.provider.ts`).
   * Перехватывает КОНКРЕТНО `57014`, не generic `catch` (тикет п.5). `searchDescriptor` в лог —
   * текст запроса пользователя (или `barcode:...`), НЕ сериализация `SQL`-объекта Drizzle
   * (`toString()` дал бы `[object Object]`, `no-base-to-string`).
   */
  private async executeWithTimeout(query: ReturnType<typeof sql>, ctx: SearchExecutionContext): Promise<readonly SearchQueryRow[]> {
    try {
      const rows = await this.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = ${this.config.searchQueryTimeoutMs}`)
        return tx.execute<SearchQueryRow & Record<string, unknown>>(query)
      })
      return extractRows(rows) as readonly SearchQueryRow[]
    } catch (error: unknown) {
      if (isPostgresError(error) && error.code === POSTGRES_QUERY_CANCELED_CODE) {
        this.logger.error(
          { query: ctx.searchDescriptor, radiusMeters: ctx.radiusMeters, tenantId: ctx.tenantId },
          'search_query_timeout',
        )
        throw new SearchTemporarilyDegradedError('Search query exceeded statement_timeout (SRS-CAT-075)')
      }
      throw error
    }
  }

  /** Слайс `limit+1` → `hasMore`, ранжирование только для `sort='relevance'` (тикет п.3). */
  private toResultPage(rows: readonly SearchQueryRow[], ctx: ResultPageContext): SearchResultPage {
    const hasMore = rows.length > ctx.limit
    const pageRows = hasMore ? rows.slice(0, ctx.limit) : rows
    const now = this.clock.now()
    const items =
      ctx.sort === 'relevance'
        ? this.rankByRelevance(pageRows, ctx.params.geo?.radiusMeters, now)
        : pageRows.map((row) => toSearchResultItem(row, row.text_relevance, now))
    return { items, nextCursor: hasMore ? encodeCursor(ctx.offset + ctx.limit) : null, hasMore }
  }

  /** SRS-CAT-018/021: `RankingScoreMapper.normalize()` — адаптер НЕ считает `finalScore` сам (тикет п.6). */
  private rankByRelevance(rows: readonly SearchQueryRow[], radiusMeters: number | undefined, now: Date): readonly SearchResultItemWithPromotable[] {
    const priced = rows.map((row) => row.min_price).filter((price): price is number => price !== null)
    const priceRange: PriceRange = {
      minPriceInPage: priced.length > 0 ? Math.min(...priced) : 0,
      maxPriceInPage: priced.length > 0 ? Math.max(...priced) : 0,
    }
    const scored = rows.map((row) => ({
      row,
      finalScore: this.rankingMapper.normalize(toRankingInput(row, radiusMeters, priceRange)).finalScore,
    }))
    scored.sort((a, b) => b.finalScore - a.finalScore)
    return scored.map(({ row, finalScore }) => toSearchResultItem(row, finalScore, now))
  }
}

interface SearchExecutionContext {
  readonly tenantId: string
  readonly radiusMeters: number | undefined
  readonly searchDescriptor: string
}

interface ResultPageContext {
  readonly limit: number
  readonly offset: number
  readonly params: SearchQueryParams
  readonly sort: SearchQuery['sort']
}

interface PriceRange {
  readonly minPriceInPage: number
  readonly maxPriceInPage: number
}

/** SRS-CAT-011: адаптер защищается сам — `limit < 1`/`NaN` не строит `LIMIT 0`/некорректный SQL. */
function clampSearchLimit(requested: number): number {
  if (!Number.isFinite(requested) || requested < MIN_SEARCH_LIMIT) return MIN_SEARCH_LIMIT
  return Math.min(Math.floor(requested), MAX_SEARCH_LIMIT)
}

/** Курсор — `base64(offset)`, невалидный/отсутствующий → страница 0 (не ошибка, defensive). */
function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  try {
    const offset = Number.parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10)
    return Number.isFinite(offset) && offset >= 0 ? offset : 0
  } catch {
    return 0
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64')
}

/** Дословно `SRS-CAT-046` в TS (Clock, не `Date.now()`) — та же формула, что `postgres-pharmacy-map.adapter.ts` (DTJ-195). */
function toDushanbeTimeOfDay(utcNow: Date): string {
  const dushanbe = new Date(utcNow.getTime() + DUSHANBE_UTC_OFFSET_HOURS * MS_PER_HOUR)
  const hh = String(dushanbe.getUTCHours()).padStart(2, '0')
  const mm = String(dushanbe.getUTCMinutes()).padStart(2, '0')
  const ss = String(dushanbe.getUTCSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function toRankingInput(row: SearchQueryRow, radiusMeters: number | undefined, priceRange: PriceRange): RawRankingInput {
  return {
    textRelevance: row.text_relevance,
    offersCountInRadius: row.offers_count,
    nearestOfferDistanceMeters: radiusMeters === undefined ? null : row.nearest_distance,
    radiusMeters: radiusMeters ?? SEARCH_DEFAULT_RADIUS_METERS,
    cheapestOfferPriceDiram: row.min_price ?? priceRange.maxPriceInPage,
    minPriceInPage: priceRange.minPriceInPage,
    maxPriceInPage: priceRange.maxPriceInPage,
    reliabilityValue: row.cheapest_reliability,
  }
}

const PROMOTABLE_EXCLUDED_CATEGORIES = new Set(['potent', 'psychotropic', 'narcotic'])

/** SRS-CAT-056: не участвует в промо-подборках (тикет п.9). */
function isPromotableControlCategory(controlCategory: string): boolean {
  return !PROMOTABLE_EXCLUDED_CATEGORIES.has(controlCategory)
}

function toSearchResultItem(row: SearchQueryRow, relevanceScore: number, now: Date): SearchResultItemWithPromotable {
  return {
    medicineId: row.id,
    tradeName: row.trade_name,
    innName: row.inn_name,
    dosageForm: row.dosage_form,
    dosageStrength: row.dosage_strength,
    imageUrl: row.image_url,
    isPrescriptionRequired: row.is_prescription_required,
    cheapestOffer: toCheapestOffer(row, now),
    offersCountInRadius: row.offers_count,
    relevanceScore,
    isPromotable: isPromotableControlCategory(row.control_category),
  }
}

/** `null` = ни одной активной аптеки не несёт товар (SRS-CAT-011 `cheapestOffer` JSDoc). */
function toCheapestOffer(row: SearchQueryRow, now: Date): PharmacyOffer | null {
  if (
    row.min_price === null ||
    row.cheapest_pharmacy_id === null ||
    row.cheapest_pharmacy_name === null ||
    row.cheapest_quantity === null ||
    row.cheapest_updated_at === null
  ) {
    return null
  }
  const lastSyncedAt = new Date(row.cheapest_updated_at)
  return {
    pharmacyId: row.cheapest_pharmacy_id,
    pharmacyName: row.cheapest_pharmacy_name,
    priceDiram: row.min_price,
    stockQuantity: row.cheapest_quantity,
    distanceMeters: row.nearest_distance,
    lastSyncedAt: lastSyncedAt.toISOString(),
    isStale: now.getTime() - lastSyncedAt.getTime() > ASSUMED_INVENTORY_DELTA_SLA_MINUTES * STALE_THRESHOLD_MULTIPLIER * MS_PER_MINUTE,
  }
}

const EMPTY_FILTERS: SearchFilters = { inStockOnly: false, openNowOnly: false, is24x7Only: false }

function isPostgresError(error: unknown): error is { readonly code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
}

/**
 * Нормализация результата `db.execute(...)`/`tx.execute(...)` для разных драйверов Drizzle
 * (общий приём файла). Не generic (`@typescript-eslint/no-unnecessary-type-parameters`) —
 * вызывающая сторона приводит к нужному `*QueryRow[]` явным `as` на месте вызова.
 */
function extractRows(result: unknown): readonly unknown[] {
  if (Array.isArray(result)) {
    return result
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows
    }
  }
  return []
}

function clampLimit(requested: number): number {
  if (!Number.isFinite(requested) || requested < MIN_SUGGEST_LIMIT) return MIN_SUGGEST_LIMIT
  return Math.min(Math.floor(requested), MAX_SUGGEST_LIMIT)
}

const VALID_MATCHED_VIA = new Set<SuggestItem['matchedVia']>(['prefix', 'trigram', 'inn'])

function toSuggestItem(row: SuggestQueryRow): SuggestItem {
  const matchedVia = VALID_MATCHED_VIA.has(row.matched_via as SuggestItem['matchedVia'])
    ? (row.matched_via as SuggestItem['matchedVia'])
    : 'prefix'
  return {
    medicineId: row.id,
    tradeName: row.trade_name,
    innName: row.inn_name,
    matchedVia,
  }
}
