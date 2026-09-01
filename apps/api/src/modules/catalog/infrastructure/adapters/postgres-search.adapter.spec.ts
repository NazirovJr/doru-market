/**
 * Unit-тест `PostgresSearchProvider` (DTJ-185 `search()`/`searchByBarcode()`, DTJ-186 `suggest()`
 * — не тронуто, EP-06, R1).
 *
 * Мок `DrizzleDb` минимален (`execute<T>(...)`/`transaction(...)`), СЕМАНТИКА SQL не
 * интерпретируется — реальное поведение (ранжирование на реальных данных, `EXPLAIN`, таймаут)
 * проверяется интеграционным тестом `postgres-search.adapter.integration.spec.ts` на реальном
 * Postgres (тот же приём, что `analog-candidates.adapter.spec.ts`, DTJ-100). Здесь — КОНТРАКТ
 * адаптера: маппинг строки → `SearchResultItem`, ранжирование vs bypass по `sort`, пагинация
 * (`limit+1`/курсор), перехват `57014`, `isPromotable`, defensive-поведение suggest().
 */
import { describe, expect, it, vi } from 'vitest'
import { PostgresSearchProvider } from './postgres-search.adapter.js'
import type { TenantId } from '@/modules/tenancy/index.js'

type ProviderCtorArgs = ConstructorParameters<typeof PostgresSearchProvider>

interface DrizzleMock {
  readonly execute: ReturnType<typeof vi.fn>
  readonly transaction: ReturnType<typeof vi.fn>
}

/** `transaction()` вызывает callback с `tx.execute` — оба вызова внутри (SET LOCAL + основной запрос) резолвятся в `rows`. */
function makeDrizzleMock(rows: readonly Record<string, unknown>[]): DrizzleMock {
  const txExecute = vi.fn(() => Promise.resolve(rows))
  return {
    execute: vi.fn(() => Promise.resolve(rows)),
    transaction: vi.fn((callback: (tx: { execute: typeof txExecute }) => unknown) => callback({ execute: txExecute })),
  }
}

/** Основной запрос внутри транзакции отклоняется `error` (SET LOCAL по-прежнему проходит). */
function makeFailingDrizzleMock(error: unknown): DrizzleMock {
  return {
    execute: vi.fn(() => Promise.resolve([])),
    transaction: vi.fn((callback: (tx: { execute: ReturnType<typeof vi.fn> }) => unknown) => {
      const txExecute = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(error)
      return callback({ execute: txExecute })
    }),
  }
}

function makeLoggerMock(): { readonly error: ReturnType<typeof vi.fn> } {
  return { error: vi.fn() }
}

const FIXED_NOW = new Date('2026-08-31T10:00:00.000Z')

function makeClockMock(now: Date = FIXED_NOW): { readonly now: ReturnType<typeof vi.fn> } {
  return { now: vi.fn(() => now) }
}

function makeConfigMock(searchQueryTimeoutMs = 2_000): { readonly searchQueryTimeoutMs: number } {
  return { searchQueryTimeoutMs }
}

function makeProvider(
  db: DrizzleMock,
  overrides: {
    readonly logger?: ReturnType<typeof makeLoggerMock>
    readonly clock?: ReturnType<typeof makeClockMock>
    readonly config?: ReturnType<typeof makeConfigMock>
  } = {},
): PostgresSearchProvider {
  return new PostgresSearchProvider(
    db as unknown as ProviderCtorArgs[0],
    (overrides.logger ?? makeLoggerMock()) as unknown as ProviderCtorArgs[1],
    (overrides.clock ?? makeClockMock()) as unknown as ProviderCtorArgs[2],
    (overrides.config ?? makeConfigMock()) as unknown as ProviderCtorArgs[3],
  )
}

/**
 * `{ value: ... }`, НЕ голая строка — в отличие от `suggest()` (DTJ-186, никогда не читает
 * `tenantId`), `search()`/`searchByBarcode()` (DTJ-185) реально читают `TenantId.value`
 * (`query.tenantId.value` — тенант-скоуп, тикет «ОБЯЗАТЕЛЬНО»); голая строка дала бы
 * `.value === undefined` в логе таймаута, обнаружено этим же тестом при первом прогоне.
 */
const IRRELEVANT_TENANT_ID = { value: 'irrelevant-tenant-id' } as unknown as TenantId
const EMPTY_FILTERS = { inStockOnly: false, openNowOnly: false, is24x7Only: false }

function baseQuery(overrides: Record<string, unknown> = {}): Parameters<PostgresSearchProvider['search']>[0] {
  return {
    tenantId: IRRELEVANT_TENANT_ID,
    text: 'парацетамол',
    locale: 'ru',
    filters: EMPTY_FILTERS,
    sort: 'relevance',
    limit: 20,
    ...overrides,
  }
}

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    trade_name: 'Цитрамон',
    inn_name: 'Ацетилсалициловая кислота',
    dosage_form: 'таблетки',
    dosage_strength: '500 мг',
    image_url: null,
    is_prescription_required: false,
    control_category: 'none',
    text_relevance: 1,
    offers_count: 1,
    min_price: 1200,
    nearest_distance: 800,
    cheapest_pharmacy_id: 'ph1',
    cheapest_pharmacy_name: 'Аптека 1',
    cheapest_quantity: 5,
    // 2 минуты до FIXED_NOW (10:00) — «свежий» дефолт (isStale=false), см. дальше отдельные
    // тесты на порог устаревания.
    cheapest_updated_at: '2026-08-31T09:58:00.000Z',
    cheapest_reliability: 4.2,
    ...overrides,
  }
}

describe('PostgresSearchProvider.search() — пустой результат (SRS-CAT-077)', () => {
  it('нет совпадений → { items: [], nextCursor: null, hasMore: false }, не исключение', async () => {
    const provider = makeProvider(makeDrizzleMock([]))
    const result = await provider.search(baseQuery())
    expect(result).toEqual({ items: [], nextCursor: null, hasMore: false })
  })
})

describe('PostgresSearchProvider.search() — маппинг строки → SearchResultItem', () => {
  it('строка с офферами → cheapestOffer заполнен, isStale вычислен через Clock', async () => {
    const db = makeDrizzleMock([makeRow()])
    const provider = makeProvider(db)
    const result = await provider.search(baseQuery())
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.cheapestOffer).toEqual({
      pharmacyId: 'ph1',
      pharmacyName: 'Аптека 1',
      priceDiram: 1200,
      stockQuantity: 5,
      distanceMeters: 800,
      lastSyncedAt: '2026-08-31T09:58:00.000Z',
      isStale: false,
    })
  })

  it.each([
    ['2026-08-31T09:58:00.000Z', false], // 2 мин назад — < 15 мин порога (5×3)
    ['2026-08-31T09:44:00.000Z', true], // 16 мин назад — > 15 мин порога
  ])('isStale=%s для cheapest_updated_at=%s (ASSUMED_INVENTORY_DELTA_SLA_MINUTES×3)', async (updatedAt, expectedStale) => {
    const provider = makeProvider(makeDrizzleMock([makeRow({ cheapest_updated_at: updatedAt })]))
    const result = await provider.search(baseQuery())
    expect(result.items[0]?.cheapestOffer?.isStale).toBe(expectedStale)
  })

  it('строка без офферов (min_price=null) → cheapestOffer=null, offersCountInRadius=0', async () => {
    const row = makeRow({
      offers_count: 0,
      min_price: null,
      nearest_distance: null,
      cheapest_pharmacy_id: null,
      cheapest_pharmacy_name: null,
      cheapest_quantity: null,
      cheapest_updated_at: null,
      cheapest_reliability: 3.5,
    })
    const provider = makeProvider(makeDrizzleMock([row]))
    const result = await provider.search(baseQuery())
    expect(result.items[0]?.cheapestOffer).toBeNull()
    expect(result.items[0]?.offersCountInRadius).toBe(0)
  })

  it.each([
    ['none', true],
    ['prescription_only', true],
    ['potent', false],
    ['psychotropic', false],
    ['narcotic', false],
  ])('control_category=%s → isPromotable=%s (SRS-CAT-056)', async (controlCategory, expected) => {
    const provider = makeProvider(makeDrizzleMock([makeRow({ control_category: controlCategory })]))
    const result = await provider.search(baseQuery())
    expect((result.items[0] as unknown as { isPromotable: boolean }).isPromotable).toBe(expected)
  })
})

describe('PostgresSearchProvider.search() — ранжирование vs bypass (тикет п.3)', () => {
  it('sort=relevance: две строки с разным text_relevance — более релевантная первая', async () => {
    const rows = [
      makeRow({ id: 'low', text_relevance: 0.2, min_price: 1000 }),
      makeRow({ id: 'high', text_relevance: 1.0, min_price: 1000 }),
    ]
    const provider = makeProvider(makeDrizzleMock(rows))
    const result = await provider.search(baseQuery({ sort: 'relevance' }))
    expect(result.items[0]?.medicineId).toBe('high')
    expect(result.items[0]?.relevanceScore).toBeGreaterThan(result.items[1]?.relevanceScore ?? 0)
  })

  it('sort=price_asc: композитная формула НЕ применяется — relevanceScore = сырой text_relevance, порядок из SQL сохранён', async () => {
    const rows = [makeRow({ id: 'a', text_relevance: 0.3 }), makeRow({ id: 'b', text_relevance: 0.9 })]
    const provider = makeProvider(makeDrizzleMock(rows))
    const result = await provider.search(baseQuery({ sort: 'price_asc' }))
    expect(result.items.map((item) => item.medicineId)).toEqual(['a', 'b'])
    expect(result.items[0]?.relevanceScore).toBe(0.3)
    expect(result.items[1]?.relevanceScore).toBe(0.9)
  })
})

describe('PostgresSearchProvider.search() — пагинация (limit+1/курсор)', () => {
  it('строк больше limit → hasMore=true, лишняя строка отброшена, nextCursor непустой', async () => {
    const rows = [makeRow({ id: 'a' }), makeRow({ id: 'b' }), makeRow({ id: 'c' })]
    const provider = makeProvider(makeDrizzleMock(rows))
    const result = await provider.search(baseQuery({ limit: 2 }))
    expect(result.items).toHaveLength(2)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).not.toBeNull()
  })

  it('строк не больше limit → hasMore=false, nextCursor=null', async () => {
    const provider = makeProvider(makeDrizzleMock([makeRow()]))
    const result = await provider.search(baseQuery({ limit: 20 }))
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })
})

describe('PostgresSearchProvider.search() — режим штрихкода (SRS-CAT-024 п.2)', () => {
  it('text из 13 цифр маршрутизируется в searchByBarcode(), не в обычный текстовый поиск', async () => {
    const db = makeDrizzleMock([makeRow({ id: 'barcode-match' })])
    const provider = makeProvider(db)
    const result = await provider.search(baseQuery({ text: '4870123456789' }))
    expect(result.items[0]?.medicineId).toBe('barcode-match')
    expect(db.transaction).toHaveBeenCalledTimes(1)
  })
})

describe('PostgresSearchProvider.search() — таймаут (SRS-CAT-075, TC-CAT-025)', () => {
  it('код 57014 → SearchTemporarilyDegradedError, залогирован search_query_timeout, НЕ generic throw', async () => {
    const db = makeFailingDrizzleMock({ code: '57014', message: 'canceling statement due to statement timeout' })
    const logger = makeLoggerMock()
    const provider = makeProvider(db, { logger })
    await expect(provider.search(baseQuery())).rejects.toThrow(/SearchTemporarilyDegradedError|statement_timeout/i)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: IRRELEVANT_TENANT_ID.value }),
      'search_query_timeout',
    )
  })

  it('другой код ошибки БД — пробрасывается КАК ЕСТЬ, не маскируется под SearchTemporarilyDegradedError', async () => {
    const dbError = { code: '23505', message: 'unique_violation' }
    const provider = makeProvider(makeFailingDrizzleMock(dbError))
    await expect(provider.search(baseQuery())).rejects.toBe(dbError)
  })
})

describe('PostgresSearchProvider.suggest() — базовый контракт', () => {
  it('пустой prefix (после trim) → [] без обращения к БД', async () => {
    const db = makeDrizzleMock([])
    const provider = makeProvider(db)
    const result = await provider.suggest('   ', IRRELEVANT_TENANT_ID, 10)
    expect(result).toEqual([])
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('маппит строки БД (snake_case) в SuggestItem (camelCase)', async () => {
    const db = makeDrizzleMock([
      { id: 'm1', trade_name: 'Но-шпа', inn_name: 'Дротаверин', matched_via: 'prefix' },
    ])
    const provider = makeProvider(db)
    const result = await provider.suggest('но-ш', IRRELEVANT_TENANT_ID, 10)
    expect(result).toEqual([
      { medicineId: 'm1', tradeName: 'Но-шпа', innName: 'Дротаверин', matchedVia: 'prefix' },
    ])
  })

  it('вызывает db.execute ровно один раз на вызов', async () => {
    const db = makeDrizzleMock([{ id: 'm1', trade_name: 'X', inn_name: 'Y', matched_via: 'trigram' }])
    const provider = makeProvider(db)
    await provider.suggest('парац', IRRELEVANT_TENANT_ID, 10)
    expect(db.execute).toHaveBeenCalledTimes(1)
  })

  it('неизвестное значение matched_via из БД — defensive fallback на "prefix", не падение', async () => {
    const db = makeDrizzleMock([
      { id: 'm1', trade_name: 'X', inn_name: 'Y', matched_via: 'something-unexpected' },
    ])
    const provider = makeProvider(db)
    const result = await provider.suggest('но-ш', IRRELEVANT_TENANT_ID, 10)
    expect(result[0]?.matchedVia).toBe('prefix')
  })

  it('извлекает строки из формы { rows: [...] } (альтернативная форма ответа драйвера)', async () => {
    const db: DrizzleMock = {
      execute: vi.fn(() =>
        Promise.resolve({
          rows: [{ id: 'm1', trade_name: 'X', inn_name: 'Y', matched_via: 'inn' }],
        }),
      ),
      transaction: vi.fn(),
    }
    const provider = makeProvider(db)
    const result = await provider.suggest('парац', IRRELEVANT_TENANT_ID, 10)
    expect(result).toHaveLength(1)
    expect(result[0]?.matchedVia).toBe('inn')
  })
})

describe('PostgresSearchProvider.suggest() — клампинг limit (C6)', () => {
  it('limit = 0 клампится до 1, не бросает и не строит LIMIT 0', async () => {
    const db = makeDrizzleMock([])
    const provider = makeProvider(db)
    await expect(provider.suggest('парац', IRRELEVANT_TENANT_ID, 0)).resolves.toEqual([])
    expect(db.execute).toHaveBeenCalledTimes(1)
  })

  it('limit < 0 клампится до 1', async () => {
    const db = makeDrizzleMock([])
    const provider = makeProvider(db)
    await expect(provider.suggest('парац', IRRELEVANT_TENANT_ID, -5)).resolves.toEqual([])
  })

  it('чрезмерный limit (10000) клампится сверху защитой адаптера', async () => {
    const db = makeDrizzleMock([])
    const provider = makeProvider(db)
    await expect(provider.suggest('парац', IRRELEVANT_TENANT_ID, 10_000)).resolves.toEqual([])
    expect(db.execute).toHaveBeenCalledTimes(1)
  })
})
