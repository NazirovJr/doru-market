/**
 * Тесты `SearchCacheService` (DTJ-187, EP-06, SRS-CAT-058).
 *
 * `buildSearchCacheKey`/`buildSuggestCacheKey` — ЧИСТЫЕ функции без I/O, unit-уровень по
 * тест-плану тикета буквально («Unit: стабильность сериализации ключа при разном порядке
 * полей»). Остальные методы здесь проверяются на `FakeRedisClient` (координационная логика
 * get/set/graceful degradation); TTL-истечение на РЕАЛЬНОМ Redis — отдельный интеграционный
 * тест (`apps/api/test/integration/catalog/search-cache.integration.spec.ts`, тест-план
 * тикета: «Интеграционные (Testcontainers Redis, НЕ мок)»).
 */
import type Redis from 'ioredis'
import type { Logger } from 'pino'
import { describe, expect, it, vi } from 'vitest'
import {
  SEARCH_RESULTS_CACHE_TTL_SECONDS,
  SUGGESTIONS_CACHE_TTL_SECONDS,
  SearchCacheService,
  buildSearchCacheKey,
  buildSuggestCacheKey,
  type SearchCacheKeyInput,
} from './search-cache.service.js'
import { FakeRedisClient } from './__tests__/fake-redis-client.js'
import type { SearchResultPage, SuggestItem } from '@/modules/catalog/application/search/ports/search-provider.port.js'

function fakeLogger(): Logger {
  return { warn: vi.fn() } as unknown as Logger
}

function makeService(): { readonly service: SearchCacheService; readonly redis: FakeRedisClient; readonly logger: Logger } {
  const redis = new FakeRedisClient()
  const logger = fakeLogger()
  return { service: new SearchCacheService(redis as unknown as Redis, logger), redis, logger }
}

const BASE_KEY_INPUT: SearchCacheKeyInput = {
  tenantId: 'tenant-A',
  text: 'парацетамол',
  filters: { inStockOnly: true, openNowOnly: false, is24x7Only: false, categoryId: 7 },
  sort: 'relevance',
}

const SAMPLE_PAGE: SearchResultPage = { items: [], nextCursor: null, hasMore: false }
const SAMPLE_SUGGESTIONS: readonly SuggestItem[] = [
  { medicineId: 'med-1', tradeName: 'Парацетамол', innName: 'Paracetamol', matchedVia: 'prefix' },
]

describe('buildSearchCacheKey (DTJ-187, критерий приёмки 3)', () => {
  it('одинаковый filters с разным порядком полей объекта JS даёт ОДИНАКОВЫЙ ключ', () => {
    const inputA: SearchCacheKeyInput = {
      ...BASE_KEY_INPUT,
      filters: { inStockOnly: true, openNowOnly: false, is24x7Only: false, categoryId: 7 },
    }
    const inputB: SearchCacheKeyInput = {
      ...BASE_KEY_INPUT,
      filters: { categoryId: 7, is24x7Only: false, inStockOnly: true, openNowOnly: false },
    }

    expect(buildSearchCacheKey(inputA)).toBe(buildSearchCacheKey(inputB))
  })

  it('ключ несёт префикс catalog:search: и tenantId в открытом виде', () => {
    const key = buildSearchCacheKey(BASE_KEY_INPUT)
    expect(key.startsWith('catalog:search:tenant-A:')).toBe(true)
  })

  it('разный text даёт РАЗНЫЙ ключ (хэш не игнорирует запрос)', () => {
    const keyA = buildSearchCacheKey({ ...BASE_KEY_INPUT, text: 'парацетамол' })
    const keyB = buildSearchCacheKey({ ...BASE_KEY_INPUT, text: 'ибупрофен' })
    expect(keyA).not.toBe(keyB)
  })

  it('разный tenantId даёт РАЗНЫЙ ключ (изоляция между тенантами)', () => {
    const keyA = buildSearchCacheKey({ ...BASE_KEY_INPUT, tenantId: 'tenant-A' })
    const keyB = buildSearchCacheKey({ ...BASE_KEY_INPUT, tenantId: 'tenant-B' })
    expect(keyA).not.toBe(keyB)
  })
})

describe('buildSuggestCacheKey (DTJ-187)', () => {
  it('строит catalog:suggest:{tenantId}:{normalizedQuery} дословно', () => {
    expect(buildSuggestCacheKey('tenant-A', 'парац')).toBe('catalog:suggest:tenant-A:парац')
  })
})

describe('SearchCacheService — результаты поиска', () => {
  it('getSearchResults на пустом кэше возвращает null', async () => {
    const { service } = makeService()
    await expect(service.getSearchResults('catalog:search:tenant-A:abc')).resolves.toBeNull()
  })

  it('setSearchResults затем getSearchResults возвращает то же значение (roundtrip)', async () => {
    const { service, redis } = makeService()
    const key = 'catalog:search:tenant-A:abc'
    await service.setSearchResults(key, SAMPLE_PAGE)
    await expect(service.getSearchResults(key)).resolves.toEqual(SAMPLE_PAGE)
    // TTL по умолчанию — именованная константа тикета (30с), не магическое число в вызове.
    await expect(redis.get(key)).resolves.not.toBeNull()
    expect(SEARCH_RESULTS_CACHE_TTL_SECONDS).toBe(30)
  })

  it('getSearchResults деградирует до null и логирует warn при ошибке Redis (не бросает)', async () => {
    const logger = fakeLogger()
    const throwingRedis = { get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) }
    const service = new SearchCacheService(throwingRedis as unknown as Redis, logger)

    await expect(service.getSearchResults('any-key')).resolves.toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('setSearchResults не бросает и логирует warn при ошибке записи в Redis', async () => {
    const logger = fakeLogger()
    const throwingRedis = { set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) }
    const service = new SearchCacheService(throwingRedis as unknown as Redis, logger)

    await expect(service.setSearchResults('any-key', SAMPLE_PAGE)).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})

describe('SearchCacheService — автодополнение', () => {
  it('setSuggestions затем getSuggestions возвращает то же значение (roundtrip)', async () => {
    const { service } = makeService()
    const key = buildSuggestCacheKey('tenant-A', 'парац')
    await service.setSuggestions(key, SAMPLE_SUGGESTIONS)
    await expect(service.getSuggestions(key)).resolves.toEqual(SAMPLE_SUGGESTIONS)
    expect(SUGGESTIONS_CACHE_TTL_SECONDS).toBe(300)
  })

  it('getSuggestions на пустом кэше возвращает null (не пустой массив — отличается от trending)', async () => {
    const { service } = makeService()
    await expect(service.getSuggestions('catalog:suggest:tenant-A:xyz')).resolves.toBeNull()
  })
})

describe('SearchCacheService.getTrendingSearches (DTJ-187, критерий приёмки 2)', () => {
  it('ключ trending_searches:{tenantId} отсутствует в Redis → [] БЕЗ исключения', async () => {
    const { service } = makeService()
    await expect(service.getTrendingSearches('tenant-A')).resolves.toEqual([])
  })

  it('читает РЕАЛЬНО заполненный ключ trending_searches:{tenantId}', async () => {
    const { service, redis } = makeService()
    await redis.set('trending_searches:tenant-A', JSON.stringify(['парацетамол', 'ибупрофен']), 'EX', 3600)
    await expect(service.getTrendingSearches('tenant-A')).resolves.toEqual(['парацетамол', 'ибупрофен'])
  })

  it('деградирует до [] (не бросает) при недоступности Redis', async () => {
    const logger = fakeLogger()
    const throwingRedis = { get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) }
    const service = new SearchCacheService(throwingRedis as unknown as Redis, logger)

    await expect(service.getTrendingSearches('tenant-A')).resolves.toEqual([])
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})
