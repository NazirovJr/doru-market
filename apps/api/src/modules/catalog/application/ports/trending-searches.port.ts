/**
 * Порт `TrendingSearchesPort` (EP-06, DTJ-189) — граница `application` над
 * `SearchCacheService.getTrendingSearches` (DTJ-187, `infrastructure/cache/search-cache.service.ts`).
 *
 * Тот же архитектурный разрыв и то же решение, что `cache-lock.port.ts` (см. его JSDoc для
 * полного обоснования: прямая инъекция `SearchCacheService` по классу в `application/use-cases/*`
 * нарушает машинно проверяемое правило `application-does-not-know-infrastructure`
 * `.dependency-cruiser.cjs`, несмотря на явное намерение DTJ-187/`catalog.module.ts`).
 *
 * Узкий интерфейс — ТОЛЬКО `getTrendingSearches`, единственный метод `SearchCacheService`,
 * реально нужный `SuggestMedicinesUseCase` (пустой `prefix`, `SRS-CAT-030`). Кэш/лок
 * непустого `prefix` идёт через `CacheLockPort` (тот же приём, что `SearchMedicinesUseCase`),
 * не через этот порт — см. JSDoc `suggest-medicines.use-case.ts`.
 *
 * @see apps/api/src/modules/catalog/infrastructure/cache/search-cache.service.ts
 * @see tickets/ep05-search-map/DTJ-187.md
 * @see tickets/ep05-search-map/DTJ-189.md
 */

/** DI-токен NestJS для `TrendingSearchesPort` (D-27). */
export const TRENDING_SEARCHES_PORT = Symbol.for('@dorutj/catalog/trending-searches-port')

/** Зеркало сигнатуры `SearchCacheService.getTrendingSearches` (см. JSDoc файла — намеренно). */
export interface TrendingSearchesPort {
  getTrendingSearches(tenantId: string): Promise<string[]>
}
