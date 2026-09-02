/**
 * Unit-тест `SuggestMedicinesUseCase` (DTJ-189, EP-06, R1).
 *
 * @see tickets/ep05-search-map/DTJ-189.md (критерии приёмки, тест-план)
 */
import { describe, expect, it } from 'vitest'
import { TenantId } from '@/modules/tenancy/index.js'
import type { SearchProvider, SuggestItem } from '@/modules/catalog/application/search/ports/search-provider.port.js'
import type { CacheLockPort } from '@/modules/catalog/application/ports/cache-lock.port.js'
import type { TrendingSearchesPort } from '@/modules/catalog/application/ports/trending-searches.port.js'
import type { SearchCacheKeyBuilder } from '@/modules/catalog/application/ports/search-cache-key.port.js'
import { SuggestMedicinesUseCase } from './suggest-medicines.use-case.js'

const TENANT_ID = TenantId.from('550e8400-e29b-41d4-a716-446655440000')

class FakeSearchProvider implements SearchProvider {
  public readonly suggestCalls: { prefix: string; tenantId: string; limit: number }[] = []
  private readonly response: readonly SuggestItem[]

  constructor(response: readonly SuggestItem[] = []) {
    this.response = response
  }

  search(): Promise<never> {
    return Promise.reject(new Error('not used in this test'))
  }

  suggest(prefix: string, tenantId: TenantId, limit: number): Promise<readonly SuggestItem[]> {
    this.suggestCalls.push({ prefix, tenantId: tenantId.value, limit })
    return Promise.resolve(this.response)
  }
}

/** In-memory `CacheLockPort` — та же семантика ключа, что `RedisLockGuard`. */
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

class FakeTrendingSearchesPort implements TrendingSearchesPort {
  constructor(private readonly trending: string[] | null) {}

  getTrendingSearches(): Promise<string[]> {
    if (this.trending === null) {
      throw new Error('should not be called with null fixture directly')
    }
    return Promise.resolve(this.trending)
  }
}

const FAKE_CACHE_KEY_BUILDER: SearchCacheKeyBuilder = {
  searchResultsTtlMs: 30_000,
  suggestionsTtlMs: 300_000,
  buildSearchResultsKey: (input) => JSON.stringify(input),
  buildSuggestKey: (tenantId, prefix) => `${tenantId}:${prefix}`,
}

function makeUseCase(
  provider: FakeSearchProvider,
  trending: string[],
  cacheLock: CacheLockPort = new FakeCacheLockPort(),
): SuggestMedicinesUseCase {
  return new SuggestMedicinesUseCase(
    provider,
    cacheLock,
    new FakeTrendingSearchesPort(trending),
    FAKE_CACHE_KEY_BUILDER,
  )
}

describe('SuggestMedicinesUseCase.execute (критерии приёмки DTJ-189)', () => {
  it('AC1 (TC-CAT-022): prefix=\'\' с 5 популярными запросами в Redis — возвращает 5 trending-подсказок, SearchProvider.suggest() НЕ вызван', async () => {
    const provider = new FakeSearchProvider()
    const trending = ['парацетамол', 'ношпа', 'аспирин', 'ибупрофен', 'цитрамон']
    const useCase = makeUseCase(provider, trending)

    const result = await useCase.execute({ prefix: '', tenantId: TENANT_ID, limit: 10 })

    expect(result).toEqual(trending.map((tradeName) => ({ kind: 'trending', tradeName })))
    expect(provider.suggestCalls).toHaveLength(0)
  })

  it('AC2: trending_searches отсутствует в Redis (джоба не запускалась) — возвращает [] без исключения', async () => {
    const provider = new FakeSearchProvider()
    const useCase = makeUseCase(provider, [])

    const result = await useCase.execute({ prefix: '', tenantId: TENANT_ID, limit: 10 })

    expect(result).toEqual([])
  })

  it('AC3: prefix=\'но-ш\' — вызывает SearchProvider.suggest() при промахе кэша, результат замаплен в SuggestMedicineItem[]', async () => {
    const providerItems: SuggestItem[] = [
      { medicineId: 'm1', tradeName: 'Но-шпа', innName: 'дротаверин', matchedVia: 'trigram' },
    ]
    const provider = new FakeSearchProvider(providerItems)
    const useCase = makeUseCase(provider, [])

    const result = await useCase.execute({ prefix: 'но-ш', tenantId: TENANT_ID, limit: 10 })

    expect(provider.suggestCalls).toEqual([{ prefix: 'но-ш', tenantId: TENANT_ID.value, limit: 10 }])
    expect(result).toEqual([{ ...providerItems[0], kind: 'medicine' }])
  })

  it('AC4: prefix=\'но-ш\' вызван дважды подряд — второй вызов НЕ обращается к SearchProvider.suggest() (кэш-хит)', async () => {
    const providerItems: SuggestItem[] = [
      { medicineId: 'm1', tradeName: 'Но-шпа', innName: 'дротаверин', matchedVia: 'trigram' },
    ]
    const provider = new FakeSearchProvider(providerItems)
    const cacheLock = new FakeCacheLockPort()
    const useCase = makeUseCase(provider, [], cacheLock)
    const command = { prefix: 'но-ш', tenantId: TENANT_ID, limit: 10 }

    await useCase.execute(command)
    await useCase.execute(command)

    expect(provider.suggestCalls).toHaveLength(1)
  })

  it('trending-подсказка не несёт medicineId/innName/matchedVia (документированное отклонение формы)', async () => {
    const provider = new FakeSearchProvider()
    const useCase = makeUseCase(provider, ['аспирин'])

    const result = await useCase.execute({ prefix: '   ', tenantId: TENANT_ID, limit: 10 })

    expect(result).toEqual([{ kind: 'trending', tradeName: 'аспирин' }])
    expect(result[0]).not.toHaveProperty('medicineId')
  })
})
