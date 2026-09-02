/**
 * `SearchMedicinesUseCase` (DTJ-188, EP-06 «Умный поиск + ранжирование + автодополнение», R1).
 *
 * Единственная точка входа полнотекстового поиска — собирает воедино нормализацию запроса
 * (DTJ-182), кэш+stampede-защиту (DTJ-187), вызов `SearchProvider` (DTJ-180/185) и
 * логирование для аналитики (DTJ-181). Presentation (DTJ-190, ещё не существует — блокируется
 * этим тикетом) вызовет `execute()` как единственную точку входа.
 *
 * **Решение CTO по фильтрам `openNowOnly`/`is24x7Only` (DTJ-188 п.1г).** Ticket-текст
 * противоречит сам себе, предлагая выбрать между «use case вычисляет `nowInTenantTz` через
 * `PharmacyOpeningHoursPolicy`/`Clock` и передаёт параметром» и «SQL сам вычисляет». Решение
 * CTO (зафиксировано в задании на эту сессию): УЖЕ реализовано вторым путём —
 * `PostgresSearchProvider.toQueryParams()` (`infrastructure/adapters/postgres-search.adapter.ts`,
 * `@Inject(CLOCK)`) сам вызывает `toDushanbeTimeOfDay(this.clock.now())`, когда
 * `filters.openNowOnly`, и передаёт готовое время в SQL (`postgres-search.sql.ts`,
 * `openNowConditionFragment`). Use case НЕ инжектирует `PharmacyOpeningHoursPolicy`/`TENANT_CLOCK`
 * и НЕ пересчитывает время повторно — только пробрасывает `filters` (включая `openNowOnly`/
 * `is24x7Only`) в `SearchQuery` как есть (шаг `buildSearchQuery` ниже). Эмпирически подтверждено:
 * `TENANT_CLOCK` не забинжен НИГДЕ в `catalog.module.ts` — инъекция `PharmacyOpeningHoursPolicy`
 * сюда сломала бы DI (`UnknownDependenciesException`) без дополнительной, не запрошенной этим
 * тикетом, инфраструктурной работы.
 *
 * **Ранжирование (п.1в/1д тикета) уже полностью реализовано адаптером, use case его не
 * дублирует.** Проверено чтением `postgres-search.sql.ts`/`postgres-search.adapter.ts`:
 *   - Browsing-режим (`categoryId` задан, `text===''`) — SQL уже форсирует
 *     `text_relevance = FORCED_TEXT_RELEVANCE_FOR_BROWSING (1.0)` для ВСЕХ кандидатов
 *     (`buildBrowsingCandidatesQuery`), и при `sort !== 'relevance'` адаптер вообще не идёт
 *     через `RankingScoreMapper` (`toResultPage`: `pageRows.map(row => toSearchResultItem(row,
 *     row.text_relevance, now))`) — значит `SearchResultItem.relevanceScore === 1.0` для всех
 *     элементов automatически, когда use case передаёт `sort: 'price_asc'` (см. ниже).
 *   - `sort === 'relevance'` — адаптер сам вызывает `RankingScoreMapper.normalize()`
 *     (`rankByRelevance`).
 *   Единственная обязанность use case для этого пункта — детектировать browsing-режим и
 *   выбрать `price_asc` дефолтом, когда клиент не указал `sort` явно (`SRS-CAT-023/048`).
 *
 * **Кэш + stampede-защита (п.1а/1ж).** `SearchQuery` (порт, DTJ-180) НЕ несёт поле для
 * альтернативного (транслитерированного) варианта запроса — единственное поле `text: string`
 * (см. ниже, «ASSUMPTION q1/q2»). Кэш-ключ строится через `SearchCacheKeyBuilder.buildSearchResultsKey`
 * (тонкий `application`-порт над `buildSearchCacheKey`, DTJ-187 — см. JSDoc `search-cache-key.port.ts`
 * за архитектурным обоснованием порта) на СЫРОМ (не нормализованном) `command.text` — идентичный
 * пользовательский ввод обязан давать идентичный ключ независимо от внутренней нормализации.
 * Всё вычисление (включая сетевой вызов `SearchProvider`) обёрнуто `CacheLockPort.withLock` c
 * TTL `SearchCacheKeyBuilder.searchResultsTtlMs` (= `SEARCH_RESULTS_CACHE_TTL_SECONDS`, DTJ-187,
 * `SRS-CAT-058`) — при попадании в кэш `withLock` возвращает сохранённое значение БЕЗ повторного
 * вызова `compute()` (`RedisLockGuard` использует один и тот же ключ и как мьютекс, и как
 * хранилище результата — см. его JSDoc); при одновременном промахе нескольких запросов
 * вычисляет РОВНО ОДИН раз (критерий приёмки 3).
 *
 * **Почему `CacheLockPort`/`TrendingSearchesPort`/`SearchCacheKeyBuilder`, а не прямая инъекция
 * `RedisLockGuard`/`SearchCacheService` по классу.** JSDoc DTJ-187 и комментарий
 * `catalog.module.ts` буквально описывают приём «без Symbol-токена, инъекция по классу» — но
 * это ломает машинно проверяемое правило `application-does-not-know-infrastructure`
 * (`.dependency-cruiser.cjs`, `severity: 'error'`), эмпирически подтверждено на пробном файле
 * (см. отчёт сдачи DTJ-188). Три тонких порта здесь — решение этого разрыва, детали — в JSDoc
 * каждого файла порта.
 *
 * **ASSUMPTION: q1/q2 (транслит) не передаются провайдеру одновременно.** Тикет (п.1б) просит
 * передать `{ q1: primary, q2: alternate }` в `SearchProvider.search()`, но порт `SearchQuery`
 * (DTJ-180, «дословно по SRS-CAT-011», «никаких полей сверх специфицированных», «менять её
 * позже — дорого») несёт ТОЛЬКО одну строку `text` — `postgres-search.sql.ts` тоже документирует
 * это как открытое расхождение («q1/q2 НЕ реализован... загрузчик translit-map.json назначен
 * DTJ-188»). Менять порт вне `files_owned` DTJ-188/DTJ-180 — нарушение Ж7. Разумная реализация
 * в рамках существующего порта (задокументирована здесь, не имитация): ищем по `primary`; если
 * результат пуст И есть `alternate` — повторяем поиск по `alternate` (тот же принцип, что
 * `SRS-CAT-024` п.3 «дополнительный вариант для увеличения recall», просто последовательно,
 * а не параллельным union — порт этого не поддерживает).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-018, 022-026, 044-048, 058, 069)
 * @see tickets/ep05-search-map/DTJ-188.md
 */
import { Inject, Injectable } from '@nestjs/common'
import type { TenantId } from '@/modules/tenancy/index.js'
import type { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import {
  SEARCH_PROVIDER,
  type SearchFilters,
  type SearchProvider,
  type SearchQuery,
  type SearchResultPage,
} from '@/modules/catalog/application/search/ports/search-provider.port.js'
import {
  QueryNormalizationService,
  type NormalizedQuery,
} from '@/modules/catalog/domain/services/query-normalization.service.js'
import {
  CACHE_LOCK_PORT,
  type CacheLockPort,
} from '@/modules/catalog/application/ports/cache-lock.port.js'
import {
  SEARCH_QUERY_LOG_REPOSITORY,
  type SearchQueryLogRepository,
} from '@/modules/catalog/application/ports/search-query-log.port.js'
import {
  SEARCH_CACHE_KEY_BUILDER,
  type SearchCacheKeyBuilder,
  type SearchResultsCacheKeyInput,
} from '@/modules/catalog/application/ports/search-cache-key.port.js'

/**
 * Команда `execute()`. Форма НАМЕРЕННО отличается от порта `SearchQuery` в двух местах:
 *   - `sort?` — опционален (порт требует конкретное значение): use case обязан САМ выбрать
 *     дефолт для browsing-режима (`SRS-CAT-048`, «условно при непустом text»), поэтому команда
 *     обязана различать «клиент явно попросил `relevance`» от «клиент вообще не указал».
 *   - `customerId` — риски тикета: use case не читает HTTP-контекст напрямую (`02` §3.2),
 *     гость/пользователь резолвится ДО вызова (presentation, DTJ-190 — не этот тикет).
 */
/** Пара «эффективный радиус + эффективная сортировка» — после дефолтов/defensive-дублей (max-params C5). */
interface EffectiveSearchContext {
  readonly radiusMeters: number | undefined
  readonly sort: SearchQuery['sort']
}

export interface SearchMedicinesCommand {
  readonly tenantId: TenantId
  readonly text: string
  readonly locale: 'tj' | 'ru' | 'en'
  readonly geo?: GeoPoint
  /** Тихо игнорируется, если `geo` не задан (`SRS-CAT-044`, defensive-дубль DTJ-188 п.2). */
  readonly radiusMeters?: number
  readonly filters: SearchFilters
  readonly sort?: SearchQuery['sort']
  readonly cursor?: string
  readonly limit: number
  readonly customerId: string | null
}

@Injectable()
export class SearchMedicinesUseCase {
  /* eslint-disable max-params -- NestJS DI: 5 портов в конструкторе — та же практика, что
     `postgres-search.adapter.ts` (4 провайдера, тот же обоснованный повод). */
  constructor(
    @Inject(SEARCH_PROVIDER) private readonly searchProvider: SearchProvider,
    // Явный @Inject: `QueryNormalizationService` — plain-класс без своего @Injectable()
    // декоратора (домен, DTJ-182); esbuild (vitest) не эмитит `design:paramtypes` для таких
    // параметров, тот же приём, что `ConfigService` в `resolve-medicine-by-composite.use-case.ts`.
    @Inject(QueryNormalizationService) private readonly queryNormalizer: QueryNormalizationService,
    @Inject(CACHE_LOCK_PORT) private readonly cacheLock: CacheLockPort,
    @Inject(SEARCH_QUERY_LOG_REPOSITORY) private readonly queryLog: SearchQueryLogRepository,
    @Inject(SEARCH_CACHE_KEY_BUILDER) private readonly cacheKeyBuilder: SearchCacheKeyBuilder,
  ) {}
  /* eslint-enable max-params */

  /**
   * `search_query_log` пишется РОВНО ОДИН раз на успешный вызов (DoD DTJ-188) — включая
   * кэш-хиты (аналитика/trending обязаны видеть КАЖДЫЙ реальный поисковый запрос пользователя,
   * не только те, что дошли до `SearchProvider`), и НЕ пишется при ошибке (запись — после
   * успешного `resolveResultPage`, до неё исключение просто пробрасывается).
   */
  async execute(command: SearchMedicinesCommand): Promise<SearchResultPage> {
    const resultPage = await this.resolveResultPage(command)
    await this.queryLog.insert({
      tenantId: command.tenantId.value,
      customerId: command.customerId,
      // Исходный текст ДО нормализации (DTJ-188 «Что сделать» п.1е) — не `primary`/`alternate`.
      queryText: command.text,
      resultsCount: resultPage.items.length,
    })
    return resultPage
  }

  private async resolveResultPage(command: SearchMedicinesCommand): Promise<SearchResultPage> {
    const normalized = this.queryNormalizer.normalize(command.text)
    const effectiveRadiusMeters = command.geo === undefined ? undefined : command.radiusMeters
    const isBrowsingMode =
      command.filters.categoryId !== undefined && normalized.mode === 'text' && normalized.primary === ''
    const effectiveSort = command.sort ?? (isBrowsingMode ? 'price_asc' : 'relevance')
    const context: EffectiveSearchContext = { radiusMeters: effectiveRadiusMeters, sort: effectiveSort }
    const cacheKey = this.cacheKeyBuilder.buildSearchResultsKey(this.buildCacheKeyInput(command, context))
    return this.cacheLock.withLock(cacheKey, this.cacheKeyBuilder.searchResultsTtlMs, () =>
      this.compute(command, normalized, context),
    )
  }

  private buildCacheKeyInput(
    command: SearchMedicinesCommand,
    context: EffectiveSearchContext,
  ): SearchResultsCacheKeyInput {
    const base: SearchResultsCacheKeyInput = {
      tenantId: command.tenantId.value,
      text: command.text,
      filters: command.filters,
      sort: context.sort,
    }
    const withGeo: SearchResultsCacheKeyInput =
      command.geo === undefined
        ? base
        : { ...base, geo: command.geo, ...(context.radiusMeters === undefined ? {} : { radiusMeters: context.radiusMeters }) }
    return command.cursor === undefined ? withGeo : { ...withGeo, cursor: command.cursor }
  }

  private async compute(
    command: SearchMedicinesCommand,
    normalized: NormalizedQuery,
    context: EffectiveSearchContext,
  ): Promise<SearchResultPage> {
    if (normalized.mode === 'barcode') {
      // SRS-CAT-024 п.2 / ASSUMPTION (см. JSDoc файла «searchByBarcode()»): порт `SearchProvider`
      // (DTJ-180, frozen) не объявляет `searchByBarcode` — маршрутизация штрихкода к нему
      // происходит ВНУТРИ `PostgresSearchProvider.search()` самостоятельно (`isBarcodeShaped`,
      // defense-in-depth), поэтому use case вызывает единственный метод, который есть на
      // интерфейсе, передавая штрихкод как `text`.
      return this.searchProvider.search(this.buildSearchQuery(command, normalized.value, context))
    }

    const primaryQuery = this.buildSearchQuery(command, normalized.primary, context)
    const primaryResult = await this.searchProvider.search(primaryQuery)
    if (primaryResult.items.length > 0 || normalized.alternate === null) {
      return primaryResult
    }
    // ASSUMPTION (см. JSDoc файла «q1/q2») — второй проход по транслит-варианту при пустом
    // результате первичного запроса, единственный способ использовать `alternate` без
    // изменения частично-заморожённого порта `SearchQuery` (одно поле `text`).
    const alternateQuery = this.buildSearchQuery(command, normalized.alternate, context)
    return this.searchProvider.search(alternateQuery)
  }

  private buildSearchQuery(
    command: SearchMedicinesCommand,
    text: string,
    context: EffectiveSearchContext,
  ): SearchQuery {
    const base: SearchQuery = {
      tenantId: command.tenantId,
      text,
      locale: command.locale,
      filters: command.filters,
      sort: context.sort,
      limit: command.limit,
    }
    const withGeo: SearchQuery =
      command.geo === undefined
        ? base
        : { ...base, geo: command.geo, ...(context.radiusMeters === undefined ? {} : { radiusMeters: context.radiusMeters }) }
    return command.cursor === undefined ? withGeo : { ...withGeo, cursor: command.cursor }
  }
}
