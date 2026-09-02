/**
 * Unit-тест `SearchMedicinesUseCase` (DTJ-188, EP-06, R1).
 *
 * Моки: `SEARCH_PROVIDER` (fake, счётчик вызовов `search`), `CacheLockPort` (in-memory,
 * повторяет реальную семантику `RedisLockGuard` — один и тот же ключ отдаёт закэшированное
 * значение без повторного `compute()`), `SearchQueryLogRepository` (fake, накапливает записи),
 * `SearchCacheKeyBuilder` (детерминированная сериализация — тест не зависит от деталей DTJ-187).
 * `QueryNormalizationService`/`TransliterationNormalizerService` — РЕАЛЬНЫЕ классы (чистые,
 * без I/O) с минимальной тестовой таблицей транслитерации, тот же приём, что
 * `query-normalization.service.spec.ts`.
 *
 * @see tickets/ep05-search-map/DTJ-188.md (критерии приёмки, тест-план)
 */
import { describe, expect, it } from 'vitest'
import { TenantId } from '@/modules/tenancy/index.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type {
  SearchFilters,
  SearchProvider,
  SearchQuery,
  SearchResultPage,
} from '@/modules/catalog/application/search/ports/search-provider.port.js'
import { QueryNormalizationService } from '@/modules/catalog/domain/services/query-normalization.service.js'
import { TransliterationNormalizerService } from '@/modules/catalog/domain/services/transliteration-normalizer.service.js'
import type { CacheLockPort } from '@/modules/catalog/application/ports/cache-lock.port.js'
import type {
  SearchQueryLogEntry,
  SearchQueryLogRepository,
} from '@/modules/catalog/application/ports/search-query-log.port.js'
import type { SearchCacheKeyBuilder } from '@/modules/catalog/application/ports/search-cache-key.port.js'
import { SearchMedicinesUseCase, type SearchMedicinesCommand } from './search-medicines.use-case.js'

const TENANT_ID = TenantId.from('550e8400-e29b-41d4-a716-446655440000')

const EMPTY_FILTERS: SearchFilters = {
  inStockOnly: false,
  openNowOnly: false,
  is24x7Only: false,
}

function emptyPage(): SearchResultPage {
  return { items: [], nextCursor: null, hasMore: false }
}

/** Fake `SearchProvider` — очередь ответов на `search()`, все вызовы записаны для ассертов. */
class FakeSearchProvider implements SearchProvider {
  public readonly searchCalls: SearchQuery[] = []
  private readonly responses: SearchResultPage[]

  constructor(responses: readonly SearchResultPage[] = [emptyPage()]) {
    this.responses = [...responses]
  }

  search(query: SearchQuery): Promise<SearchResultPage> {
    this.searchCalls.push(query)
    const next = this.responses.shift()
    return Promise.resolve(next ?? emptyPage())
  }

  suggest(): Promise<readonly []> {
    return Promise.reject(new Error('not used in this test'))
  }
}

/** In-memory `CacheLockPort` — та же семантика ключа, что `RedisLockGuard` (см. JSDoc порта). */
class FakeCacheLockPort implements CacheLockPort {
  private readonly store = new Map<string, unknown>()

  async withLock<T>(key: string, _ttlMs: number, compute: () => Promise<T>): Promise<T> {
    if (this.store.has(key)) {
      return this.store.get(key) as T
    }
    const result = await compute()
    this.store.set(key, result)
    return result
  }
}

class FakeSearchQueryLogRepository implements SearchQueryLogRepository {
  public readonly entries: SearchQueryLogEntry[] = []

  insert(entry: SearchQueryLogEntry): Promise<void> {
    this.entries.push(entry)
    return Promise.resolve()
  }
}

/** Детерминированный, не зависящий от DTJ-187 сериализатор — тест изолирован от его деталей. */
const FAKE_CACHE_KEY_BUILDER: SearchCacheKeyBuilder = {
  searchResultsTtlMs: 30_000,
  suggestionsTtlMs: 300_000,
  buildSearchResultsKey: (input) => JSON.stringify(input),
  buildSuggestKey: (tenantId, prefix) => `${tenantId}:${prefix}`,
}

function makeQueryNormalizer(): QueryNormalizationService {
  return new QueryNormalizationService(new TransliterationNormalizerService({ qalb: 'калб' }))
}

function makeUseCase(
  provider: FakeSearchProvider,
  queryLog: FakeSearchQueryLogRepository = new FakeSearchQueryLogRepository(),
  cacheLock: CacheLockPort = new FakeCacheLockPort(),
): SearchMedicinesUseCase {
  return new SearchMedicinesUseCase(provider, makeQueryNormalizer(), cacheLock, queryLog, FAKE_CACHE_KEY_BUILDER)
}

function baseCommand(overrides: Partial<SearchMedicinesCommand> = {}): SearchMedicinesCommand {
  return {
    tenantId: TENANT_ID,
    text: 'парацетамол',
    locale: 'ru',
    filters: EMPTY_FILTERS,
    limit: 20,
    customerId: null,
    ...overrides,
  }
}

describe('SearchMedicinesUseCase.execute (критерии приёмки DTJ-188)', () => {
  it('AC1: валидный текстовый запрос с geo — передаёт text/geo/limit в SearchProvider.search() и возвращает его результат как есть', async () => {
    const geoResult = GeoPoint.create(38.5, 68.7)
    if (!geoResult.ok) throw new Error('unreachable')
    const page: SearchResultPage = {
      items: [
        {
          medicineId: 'm1',
          tradeName: 'Парацетамол',
          innName: 'Paracetamol',
          dosageForm: 'tablet',
          dosageStrength: '500mg',
          imageUrl: null,
          isPrescriptionRequired: false,
          cheapestOffer: null,
          offersCountInRadius: 0,
          relevanceScore: 0.9,
        },
      ],
      nextCursor: null,
      hasMore: false,
    }
    const provider = new FakeSearchProvider([page])
    const useCase = makeUseCase(provider)

    const result = await useCase.execute(
      baseCommand({ geo: geoResult.value, radiusMeters: 5000 }),
    )

    expect(result).toEqual(page)
    expect(provider.searchCalls).toHaveLength(1)
    const query = provider.searchCalls[0]
    expect(query?.text).toBe('парацетамол')
    expect(query?.geo).toBe(geoResult.value)
    expect(query?.radiusMeters).toBe(5000)
    expect(query?.sort).toBe('relevance')
  })

  it('AC2 (TC-CAT-023): filters.categoryId=5 + text=\'\' без явного sort — вызывает search() с sort=price_asc, результат (уже с relevanceScore=1.0 от адаптера) проходит без изменений', async () => {
    const page: SearchResultPage = {
      items: [
        {
          medicineId: 'm1',
          tradeName: 'A',
          innName: 'a',
          dosageForm: 'tablet',
          dosageStrength: '1mg',
          imageUrl: null,
          isPrescriptionRequired: false,
          cheapestOffer: null,
          offersCountInRadius: 1,
          relevanceScore: 1.0,
        },
        {
          medicineId: 'm2',
          tradeName: 'B',
          innName: 'b',
          dosageForm: 'tablet',
          dosageStrength: '1mg',
          imageUrl: null,
          isPrescriptionRequired: false,
          cheapestOffer: null,
          offersCountInRadius: 1,
          relevanceScore: 1.0,
        },
      ],
      nextCursor: null,
      hasMore: false,
    }
    const provider = new FakeSearchProvider([page])
    const useCase = makeUseCase(provider)

    const result = await useCase.execute(
      baseCommand({ text: '', filters: { ...EMPTY_FILTERS, categoryId: 5 } }),
    )

    expect(provider.searchCalls).toHaveLength(1)
    expect(provider.searchCalls[0]?.sort).toBe('price_asc')
    expect(provider.searchCalls[0]?.text).toBe('')
    expect(result.items.every((item) => item.relevanceScore === 1)).toBe(true)
  })

  it('AC3: идентичный запрос дважды подряд — второй вызов НЕ обращается к SearchProvider.search() (кэш-хит)', async () => {
    const provider = new FakeSearchProvider([emptyPage(), emptyPage()])
    const cacheLock = new FakeCacheLockPort()
    const useCase = makeUseCase(provider, new FakeSearchQueryLogRepository(), cacheLock)
    const command = baseCommand()

    await useCase.execute(command)
    await useCase.execute(command)

    expect(provider.searchCalls).toHaveLength(1)
  })

  it('AC4 (TC-CAT-005): text — валидный, не существующий в базе штрихкод — маршрутизируется как единственный запрос с text=штрихкод, результат data:[]', async () => {
    const provider = new FakeSearchProvider([emptyPage()])
    const useCase = makeUseCase(provider)

    const result = await useCase.execute(baseCommand({ text: '4870123456789' }))

    expect(result.items).toEqual([])
    expect(provider.searchCalls).toHaveLength(1)
    expect(provider.searchCalls[0]?.text).toBe('4870123456789')
  })

  it('search_query_log: пишется ровно один раз на успешный execute(), с исходным (не нормализованным) текстом и итоговым resultsCount', async () => {
    const provider = new FakeSearchProvider([
      { items: [], nextCursor: null, hasMore: false },
    ])
    const queryLog = new FakeSearchQueryLogRepository()
    const useCase = makeUseCase(provider, queryLog)

    await useCase.execute(baseCommand({ text: '  Цитрамон  ', customerId: 'user-1' }))

    expect(queryLog.entries).toHaveLength(1)
    expect(queryLog.entries[0]).toEqual({
      tenantId: TENANT_ID.value,
      customerId: 'user-1',
      queryText: '  Цитрамон  ',
      resultsCount: 0,
    })
  })

  it('search_query_log: НЕ пишется, если SearchProvider.search() бросает исключение', async () => {
    const provider: SearchProvider = {
      search: () => Promise.reject(new Error('boom')),
      suggest: () => Promise.reject(new Error('not used')),
    }
    const queryLog = new FakeSearchQueryLogRepository()
    const useCase = new SearchMedicinesUseCase(
      provider,
      makeQueryNormalizer(),
      new FakeCacheLockPort(),
      queryLog,
      FAKE_CACHE_KEY_BUILDER,
    )

    await expect(useCase.execute(baseCommand())).rejects.toThrow('boom')
    expect(queryLog.entries).toHaveLength(0)
  })

  it('SRS-CAT-044 defensive-дубль: radiusMeters задан, но geo отсутствует — тихо игнорируется (не попадает в SearchQuery)', async () => {
    const provider = new FakeSearchProvider([emptyPage()])
    const useCase = makeUseCase(provider)

    await useCase.execute(baseCommand({ radiusMeters: 5000 }))

    expect(provider.searchCalls[0]).not.toHaveProperty('geo')
    expect(provider.searchCalls[0]).not.toHaveProperty('radiusMeters')
  })

  it('ASSUMPTION q1/q2: primary не даёт результатов, alternate (транслит) задан — повторяет поиск по alternate', async () => {
    const page: SearchResultPage = {
      items: [
        {
          medicineId: 'm1',
          tradeName: 'Калб',
          innName: 'calb',
          dosageForm: 'tablet',
          dosageStrength: '1mg',
          imageUrl: null,
          isPrescriptionRequired: false,
          cheapestOffer: null,
          offersCountInRadius: 0,
          relevanceScore: 0.5,
        },
      ],
      nextCursor: null,
      hasMore: false,
    }
    const provider = new FakeSearchProvider([emptyPage(), page])
    const useCase = makeUseCase(provider)

    const result = await useCase.execute(baseCommand({ text: 'qalb' }))

    expect(provider.searchCalls).toHaveLength(2)
    expect(provider.searchCalls[0]?.text).toBe('qalb')
    expect(provider.searchCalls[1]?.text).toBe('калб')
    expect(result).toEqual(page)
  })
})
