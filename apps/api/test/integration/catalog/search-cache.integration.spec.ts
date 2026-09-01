/**
 * Интеграционный тест `SearchCacheService` (DTJ-187, EP-06, SRS-CAT-058) — РЕАЛЬНЫЙ Redis.
 *
 * Покрывает то, что тест-план тикета относит к интеграционному уровню: TTL-истечение
 * результатов поиска/подсказок и cold-start trending (`TC-CAT-022`). Стабильность
 * сериализации ключа (критерий приёмки 3) — чистая функция, покрыта unit-тестом
 * `../../../src/modules/catalog/infrastructure/cache/search-cache.service.spec.ts`.
 *
 * **Окружение** — та же конвенция, что `redis-lock-guard.integration.spec.ts`/
 * `catalog-repository.adapter.integration.spec.ts`: `CATALOG_TEST_REDIS_URL` → `REDIS_URL` →
 * дефолт, честный `describe.skipIf` при недоступном Redis (Ж13).
 */
import Redis from 'ioredis'
import type { Logger } from 'pino'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SearchCacheService } from '@/modules/catalog/infrastructure/cache/search-cache.service.js'
import type { SearchResultPage, SuggestItem } from '@/modules/catalog/application/search/ports/search-provider.port.js'

const TEST_REDIS_URL =
  process.env.CATALOG_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379'

const PROBE_TIMEOUT_MS = 1_500
/** Короткий TTL для теста истечения — не 30/300с по умолчанию, чтобы сьют не растягивался. */
const SHORT_TTL_SECONDS = 1
const SHORT_TTL_WAIT_MS = 1_300

async function isRedisReachable(url: string): Promise<boolean> {
  const client = new Redis(url, { lazyConnect: true, connectTimeout: PROBE_TIMEOUT_MS, maxRetriesPerRequest: 1 })
  client.on('error', () => undefined)
  try {
    await client.connect()
    await client.ping()
    return true
  } catch {
    return false
  } finally {
    client.disconnect()
  }
}

function silentLogger(): Logger {
  return { warn: () => undefined } as unknown as Logger
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const redisAvailable = await isRedisReachable(TEST_REDIS_URL)

const SAMPLE_PAGE: SearchResultPage = {
  items: [
    {
      medicineId: 'med-1',
      tradeName: 'Парацетамол',
      innName: 'Paracetamol',
      dosageForm: 'tablet',
      dosageStrength: '500 mg',
      imageUrl: null,
      isPrescriptionRequired: false,
      cheapestOffer: null,
      offersCountInRadius: 0,
      relevanceScore: 1,
    },
  ],
  nextCursor: null,
  hasMore: false,
}

const SAMPLE_SUGGESTIONS: readonly SuggestItem[] = [
  { medicineId: 'med-1', tradeName: 'Парацетамол', innName: 'Paracetamol', matchedVia: 'prefix' },
]

describe.skipIf(!redisAvailable)('SearchCacheService — integration (DTJ-187, SRS-CAT-058)', () => {
  let redis: Redis
  let service: SearchCacheService
  const usedKeys: string[] = []

  beforeAll(() => {
    redis = new Redis(TEST_REDIS_URL)
    service = new SearchCacheService(redis, silentLogger())
  })

  afterAll(async () => {
    if (usedKeys.length > 0) {
      await redis.del(...usedKeys).catch(() => undefined)
    }
    await redis.quit().catch(() => undefined)
  })

  afterEach(async () => {
    if (usedKeys.length > 0) {
      await redis.del(...usedKeys).catch(() => undefined)
      usedKeys.length = 0
    }
  })

  function testKey(name: string): string {
    const key = `test:dtj187:${name}:${String(Date.now())}`
    usedKeys.push(key)
    return key
  }

  it('результаты поиска: доступны до истечения TTL, исчезают после (SRS-CAT-058, 30с в проде)', async () => {
    const key = testKey('search')
    await service.setSearchResults(key, SAMPLE_PAGE, SHORT_TTL_SECONDS)

    await expect(service.getSearchResults(key)).resolves.toEqual(SAMPLE_PAGE)

    await wait(SHORT_TTL_WAIT_MS)
    await expect(service.getSearchResults(key)).resolves.toBeNull()
  })

  it('автодополнение: доступно до истечения TTL, исчезает после (SRS-CAT-058, 300с в проде)', async () => {
    const key = testKey('suggest')
    await service.setSuggestions(key, SAMPLE_SUGGESTIONS, SHORT_TTL_SECONDS)

    await expect(service.getSuggestions(key)).resolves.toEqual(SAMPLE_SUGGESTIONS)

    await wait(SHORT_TTL_WAIT_MS)
    await expect(service.getSuggestions(key)).resolves.toBeNull()
  })

  it('TC-CAT-022: getTrendingSearches на отсутствующем ключе в РЕАЛЬНОМ Redis → [] без исключения', async () => {
    const tenantId = `dtj187-cold-start-${String(Date.now())}`
    await expect(service.getTrendingSearches(tenantId)).resolves.toEqual([])
  })

  it('getTrendingSearches читает реально заполненный ключ trending_searches:{tenantId}', async () => {
    const tenantId = `dtj187-populated-${String(Date.now())}`
    const key = `trending_searches:${tenantId}`
    usedKeys.push(key)
    await redis.set(key, JSON.stringify(['парацетамол', 'ибупрофен']), 'EX', 3600)

    await expect(service.getTrendingSearches(tenantId)).resolves.toEqual(['парацетамол', 'ибупрофен'])
  })
})
