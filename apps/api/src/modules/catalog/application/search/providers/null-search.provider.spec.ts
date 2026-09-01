/**
 * Unit-тест `NullSearchProvider` + `createSearchProvider` (DTJ-180, EP-06, R1).
 *
 * Критерий приёмки №1 тикета: `SEARCH_PROVIDER` резолвится в `NullSearchProvider`,
 * `search()`/`suggest()` не бросают исключений и возвращают пустые структуры формы
 * `SearchResultPage`/`SuggestItem[]`.
 *
 * DTJ-185: эта фабрика БОЛЬШЕ НЕ используется production DI-графом напрямую (реальная
 * ветка `'postgres' → PostgresSearchProvider` — `infrastructure/providers/
 * search-provider.factory.ts`, см. `search-provider.factory.spec.ts`) — тесты здесь остаются
 * верными для файла КАК ОН ЕСТЬ (простая, всегда-`NullSearchProvider` фабрика, без изменений
 * поведения).
 */
import { describe, expect, it, vi } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import type { FactoryProvider } from '@nestjs/common'
import { NullSearchProvider, createSearchProvider, searchProviderProvider } from './null-search.provider.js'
import { SEARCH_PROVIDER, type SearchProvider, type SearchQuery } from '../ports/search-provider.port.js'
import { TenantId } from '@/modules/tenancy/index.js'

/** Минимальный мок `ConfigService`: только `get(key)`, поведенчески настраиваемый по кейсу. */
function makeConfigServiceMock(searchDriverValue: unknown): ConfigService {
  return {
    get: vi.fn(() => searchDriverValue),
  } as unknown as ConfigService
}

/** Валидный UUID (RFC 4122 v4, канонический пример) — единственное, что требует `TenantId.from`. */
const SAMPLE_TENANT_ID = TenantId.from('550e8400-e29b-41d4-a716-446655440000')

const SAMPLE_QUERY: SearchQuery = {
  tenantId: SAMPLE_TENANT_ID,
  text: 'парацетамол',
  locale: 'ru',
  filters: { inStockOnly: false, openNowOnly: false, is24x7Only: false },
  sort: 'relevance',
  limit: 20,
}

describe('NullSearchProvider (DTJ-180)', () => {
  it('search() возвращает пустую страницу формы SearchResultPage для непустого запроса', async () => {
    const provider = new NullSearchProvider()
    await expect(provider.search(SAMPLE_QUERY)).resolves.toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    })
  })

  it('search() возвращает пустую страницу и для запроса с пустым text (режим браузинга, §7)', async () => {
    const provider = new NullSearchProvider()
    await expect(provider.search({ ...SAMPLE_QUERY, text: '' })).resolves.toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    })
  })

  it('search() не бросает исключений', async () => {
    const provider = new NullSearchProvider()
    await expect(provider.search(SAMPLE_QUERY)).resolves.not.toThrow()
  })

  it('suggest() возвращает пустой массив', async () => {
    const provider = new NullSearchProvider()
    await expect(provider.suggest('пара', SAMPLE_TENANT_ID, 10)).resolves.toEqual([])
  })

  it('suggest() не бросает исключений', async () => {
    const provider = new NullSearchProvider()
    await expect(provider.suggest('', SAMPLE_TENANT_ID, 10)).resolves.not.toThrow()
  })
})

describe('createSearchProvider (SRS-CAT-012)', () => {
  it('SEARCH_DRIVER не задан → резолвит NullSearchProvider (дефолт "postgres")', () => {
    const configService = makeConfigServiceMock(undefined)
    const provider = createSearchProvider(configService)
    expect(provider).toBeInstanceOf(NullSearchProvider)
  })

  it('SEARCH_DRIVER="postgres" → резолвит NullSearchProvider (эта фабрика не знает про infrastructure, см. JSDoc файла)', () => {
    const configService = makeConfigServiceMock('postgres')
    const provider = createSearchProvider(configService)
    expect(provider).toBeInstanceOf(NullSearchProvider)
  })

  it('SEARCH_DRIVER="elasticsearch" → тоже резолвит NullSearchProvider (реальная развилка — DTJ-191)', () => {
    const configService = makeConfigServiceMock('elasticsearch')
    const provider = createSearchProvider(configService)
    expect(provider).toBeInstanceOf(NullSearchProvider)
  })

  it('произвольное/некорректное значение SEARCH_DRIVER не бросает исключений', () => {
    const configService = makeConfigServiceMock(42)
    expect(() => createSearchProvider(configService)).not.toThrow()
  })
})

describe('searchProviderProvider (D-27 DI-биндинг)', () => {
  // Провайдер экспортирован как `Provider` (union NestJS-типов, тот же приём, что
  // `drizzleProvider`) — узкое приведение к `FactoryProvider` только здесь, в тесте,
  // не в исходном файле, чтобы не терять общность типа для потребителей.
  const factoryProvider = searchProviderProvider as FactoryProvider<SearchProvider>

  it('провайдер зарегистрирован на токен SEARCH_PROVIDER', () => {
    expect(factoryProvider.provide).toBe(SEARCH_PROVIDER)
  })

  it('useFactory ссылается на createSearchProvider (единственная реализация)', () => {
    expect(factoryProvider.useFactory).toBe(createSearchProvider)
  })

  it('inject запрашивает ровно ConfigService', () => {
    expect(factoryProvider.inject).toHaveLength(1)
  })
})
