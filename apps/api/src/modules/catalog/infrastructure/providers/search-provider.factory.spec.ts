/**
 * Unit-тест `createSearchProvider`/`searchProviderProvider` (DTJ-185, EP-06, R1, SRS-CAT-012)
 * — реальная развилка `SEARCH_DRIVER`. Контраст с `null-search.provider.spec.ts` (DTJ-180,
 * простая всегда-`NullSearchProvider` фабрика, вне production DI-графа с этого тикета).
 */
import { describe, expect, it, vi } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import type { FactoryProvider } from '@nestjs/common'
import { createSearchProvider, searchProviderProvider } from './search-provider.factory.js'
import { NullSearchProvider } from '@/modules/catalog/application/search/providers/null-search.provider.js'
import { PostgresSearchProvider } from '../adapters/postgres-search.adapter.js'
import { SEARCH_PROVIDER, type SearchProvider } from '@/modules/catalog/application/search/ports/search-provider.port.js'

function makeConfigServiceMock(searchDriverValue: unknown): ConfigService {
  return { get: vi.fn(() => searchDriverValue) } as unknown as ConfigService
}

type Deps = ConstructorParameters<typeof PostgresSearchProvider>

function makeDeps(): { readonly db: Deps[0]; readonly logger: Deps[1]; readonly clock: Deps[2]; readonly appConfig: Deps[3] } {
  return {
    db: {} as Deps[0],
    logger: { error: vi.fn() } as unknown as Deps[1],
    clock: { now: () => new Date() },
    appConfig: { searchQueryTimeoutMs: 2_000 } as unknown as Deps[3],
  }
}

describe('createSearchProvider (SRS-CAT-012, реальная развилка)', () => {
  it('SEARCH_DRIVER не задан → PostgresSearchProvider (дефолт "postgres")', () => {
    const deps = makeDeps()
    const provider = createSearchProvider(makeConfigServiceMock(undefined), deps.db, deps.logger, deps.clock, deps.appConfig)
    expect(provider).toBeInstanceOf(PostgresSearchProvider)
  })

  it('SEARCH_DRIVER="postgres" → PostgresSearchProvider', () => {
    const deps = makeDeps()
    const provider = createSearchProvider(makeConfigServiceMock('postgres'), deps.db, deps.logger, deps.clock, deps.appConfig)
    expect(provider).toBeInstanceOf(PostgresSearchProvider)
  })

  it('SEARCH_DRIVER="elasticsearch" → NullSearchProvider (R2 не готов, DTJ-191)', () => {
    const deps = makeDeps()
    const provider = createSearchProvider(makeConfigServiceMock('elasticsearch'), deps.db, deps.logger, deps.clock, deps.appConfig)
    expect(provider).toBeInstanceOf(NullSearchProvider)
  })

  it('произвольное/некорректное значение SEARCH_DRIVER не бросает исключений (фоллбэк на дефолт)', () => {
    const deps = makeDeps()
    expect(() =>
      createSearchProvider(makeConfigServiceMock(42), deps.db, deps.logger, deps.clock, deps.appConfig),
    ).not.toThrow()
  })
})

describe('searchProviderProvider (D-27 DI-биндинг)', () => {
  const factoryProvider = searchProviderProvider as FactoryProvider<SearchProvider>

  it('провайдер зарегистрирован на токен SEARCH_PROVIDER', () => {
    expect(factoryProvider.provide).toBe(SEARCH_PROVIDER)
  })

  it('useFactory ссылается на createSearchProvider', () => {
    expect(factoryProvider.useFactory).toBe(createSearchProvider)
  })

  it('inject запрашивает ConfigService + зависимости PostgresSearchProvider (5 токенов)', () => {
    expect(factoryProvider.inject).toHaveLength(5)
  })
})
