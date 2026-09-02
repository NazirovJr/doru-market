/**
 * Порт `SearchCacheKeyBuilder` (EP-06, DTJ-188/189) — граница `application` над
 * `buildSearchCacheKey`/`buildSuggestCacheKey`/TTL-константами `SearchCacheService`
 * (DTJ-187, `infrastructure/cache/search-cache.service.ts`).
 *
 * Тот же архитектурный разрыв, что `cache-lock.port.ts`/`trending-searches.port.ts` (см. их
 * JSDoc за полным обоснованием): прямой импорт ДАЖЕ чистых функций/констант из файла под
 * `infrastructure/` в файл под `application/` нарушает `application-does-not-know-
 * infrastructure` (`.dependency-cruiser.cjs`, `tsPreCompilationDeps: true` — правило видит и
 * `import type`, не только value-импорты; проверено эмпирически на пробном файле с ЧИСТО
 * типовым импортом `SearchCacheKeyInput`, тот же результат, что и с value-импортом). Здесь это
 * НЕ класс с DI (`useExisting` не подходит) — `buildSearchCacheKey`/`buildSuggestCacheKey`
 * обычные функции, TTL — константы, поэтому связывание в `catalog.module.ts` — через
 * `useValue` (композиционный корень, ему обе стороны легитимны).
 *
 * `SearchResultsCacheKeyInput` — независимая, СТРУКТУРНО идентичная копия формы
 * `SearchCacheKeyInput` (`infrastructure/cache/search-cache.service.ts`), а не импорт этого
 * типа — ровно из-за ограничения выше. Оба типа выведены из одних и тех же полей `SearchQuery`
 * (`application/search/ports/search-provider.port.ts`), расхождение исключено на уровне
 * структурной типизации TypeScript (совместимость проверяется `tsc`, а не именем типа).
 *
 * @see apps/api/src/modules/catalog/infrastructure/cache/search-cache.service.ts
 * @see tickets/ep05-search-map/DTJ-187.md
 * @see tickets/ep05-search-map/DTJ-188.md
 * @see tickets/ep05-search-map/DTJ-189.md
 */
import type { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { SearchFilters, SearchQuery } from '@/modules/catalog/application/search/ports/search-provider.port.js'

/** DI-токен NestJS для `SearchCacheKeyBuilder` (D-27). */
export const SEARCH_CACHE_KEY_BUILDER = Symbol.for('@dorutj/catalog/search-cache-key-builder')

/** Структурное зеркало `SearchCacheKeyInput` (см. JSDoc файла — намеренно, не импорт). */
export interface SearchResultsCacheKeyInput {
  readonly tenantId: string
  readonly text: string
  readonly filters: SearchFilters
  readonly geo?: GeoPoint
  readonly radiusMeters?: number
  readonly sort: SearchQuery['sort']
  readonly cursor?: string
}

/**
 * Ключи кэша + TTL (уже в миллисекундах — готовы для `CacheLockPort.withLock`, use case не
 * дублирует конверсию секунды→мс сам, `SRS-CAT-058`).
 */
export interface SearchCacheKeyBuilder {
  readonly searchResultsTtlMs: number
  readonly suggestionsTtlMs: number
  buildSearchResultsKey(input: SearchResultsCacheKeyInput): string
  buildSuggestKey(tenantId: string, normalizedPrefix: string): string
}
