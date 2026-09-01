/**
 * Unit-тест zod-контрактов поиска (DTJ-180, SRS-CAT-011). Таблица кейсов
 * `radiusMeters`/`sort`/`limit` (валидные/невалидные) — тест-план тикета.
 */
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  PharmacyOfferSchema,
  SearchFiltersSchema,
  SearchQuerySchema,
  SearchResultItemSchema,
  SearchResultPageSchema,
  SuggestItemSchema,
} from './search'

describe('SearchQuerySchema — дефолты (DTJ-180)', () => {
  it('пустой объект — все дефолты применяются (text/sort/filters/limit)', () => {
    expect(SearchQuerySchema.parse({})).toEqual({
      text: '',
      sort: 'relevance',
      limit: 20,
      filters: { inStockOnly: false, openNowOnly: false, is24x7Only: false },
    })
  })

  it('пустой text — валидный режим «браузинг по фильтрам» (§7, SRS-CAT-045)', () => {
    expect(SearchQuerySchema.parse({ text: '' }).text).toBe('')
  })
})

describe('SearchQuerySchema.radiusMeters — таблица кейсов (SRS-CAT-044)', () => {
  it.each([1000, 3000, 5000, 10000, 20000])('%d — валидное значение из фиксированного набора', (value) => {
    expect(SearchQuerySchema.parse({ radiusMeters: value }).radiusMeters).toBe(value)
  })

  it('7000 — вне разрешённого набора → ZodError с указанием на radiusMeters (критерий приёмки №4)', () => {
    expect(() => SearchQuerySchema.parse({ radiusMeters: 7000 })).toThrow(ZodError)
    try {
      SearchQuerySchema.parse({ radiusMeters: 7000 })
      expect.unreachable('parse обязан бросить ZodError')
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError)
      const zodError = error as ZodError
      expect(zodError.issues.some((issue) => issue.path.includes('radiusMeters'))).toBe(true)
    }
  })

  it('строковый query-параметр коэрсится в число (HTTP query-строка всегда строки)', () => {
    expect(SearchQuerySchema.parse({ radiusMeters: '5000' }).radiusMeters).toBe(5000)
  })

  it('нечисловая строка → ZodError', () => {
    expect(() => SearchQuerySchema.parse({ radiusMeters: 'abc' })).toThrow(ZodError)
  })

  it('radiusMeters отсутствует — не ошибка (§7.1: без geo радиус просто не используется)', () => {
    expect(SearchQuerySchema.parse({}).radiusMeters).toBeUndefined()
  })
})

describe('SearchQuerySchema.sort — таблица кейсов (SRS-CAT-048)', () => {
  it.each(['relevance', 'price_asc', 'price_desc', 'distance_asc'] as const)(
    '%s — разрешённое значение',
    (value) => {
      expect(SearchQuerySchema.parse({ sort: value }).sort).toBe(value)
    },
  )

  it('невалидное значение → ZodError с указанием на sort', () => {
    try {
      SearchQuerySchema.parse({ sort: 'random_order' })
      expect.unreachable('parse обязан бросить ZodError')
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError)
      const zodError = error as ZodError
      expect(zodError.issues.some((issue) => issue.path.includes('sort'))).toBe(true)
    }
  })

  it('sort отсутствует → дефолт relevance (безусловный дефолт схемы, см. JSDoc файла)', () => {
    expect(SearchQuerySchema.parse({}).sort).toBe('relevance')
  })
})

describe('SearchQuerySchema.limit/cursor — переиспользование cursorQuerySchema (Ж12)', () => {
  it.each(['1', '100'])('limit=%s — граница диапазона 1..100 принимается', (value) => {
    expect(SearchQuerySchema.parse({ limit: value }).limit).toBe(Number(value))
  })

  it('limit=0 — отклоняется', () => {
    expect(() => SearchQuerySchema.parse({ limit: '0' })).toThrow(ZodError)
  })

  it('limit=101 — отклоняется (не молчаливое обрезание, SRS-API-004)', () => {
    expect(() => SearchQuerySchema.parse({ limit: '101' })).toThrow(ZodError)
  })

  it('limit отсутствует — дефолт 20', () => {
    expect(SearchQuerySchema.parse({}).limit).toBe(20)
  })

  it('cursor — опциональная непрозрачная строка', () => {
    expect(SearchQuerySchema.parse({ cursor: 'opaque-cursor-value' }).cursor).toBe('opaque-cursor-value')
    expect(SearchQuerySchema.parse({}).cursor).toBeUndefined()
  })
})

describe('SearchQuerySchema.lat/lon — диапазон WGS-84', () => {
  it('валидные координаты (Душанбе) принимаются и коэрсятся из строки', () => {
    const parsed = SearchQuerySchema.parse({ lat: '38.5598', lon: '68.7870' })
    expect(parsed.lat).toBeCloseTo(38.5598)
    expect(parsed.lon).toBeCloseTo(68.787)
  })

  it('lat вне диапазона [-90, 90] → ZodError', () => {
    expect(() => SearchQuerySchema.parse({ lat: 95 })).toThrow(ZodError)
  })

  it('lon вне диапазона [-180, 180] → ZodError', () => {
    expect(() => SearchQuerySchema.parse({ lon: -200 })).toThrow(ZodError)
  })

  it('lat/lon отсутствуют — не ошибка (текстовый поиск без гео)', () => {
    const parsed = SearchQuerySchema.parse({})
    expect(parsed.lat).toBeUndefined()
    expect(parsed.lon).toBeUndefined()
  })
})

describe('SearchFiltersSchema — булевы флаги без капкана z.coerce.boolean()', () => {
  it('пустой объект — три флага дефолтятся в false, остальное отсутствует', () => {
    expect(SearchFiltersSchema.parse({})).toEqual({
      inStockOnly: false,
      openNowOnly: false,
      is24x7Only: false,
    })
  })

  it('строка "false" НЕ становится true (капкан z.coerce.boolean, см. JSDoc файла)', () => {
    expect(SearchFiltersSchema.parse({ inStockOnly: 'false' }).inStockOnly).toBe(false)
  })

  it('строка "true" становится true', () => {
    expect(SearchFiltersSchema.parse({ openNowOnly: 'true' }).openNowOnly).toBe(true)
  })

  it('реальный boolean принимается как есть (typed-вызов из apps/web)', () => {
    expect(SearchFiltersSchema.parse({ is24x7Only: true }).is24x7Only).toBe(true)
    expect(SearchFiltersSchema.parse({ is24x7Only: false }).is24x7Only).toBe(false)
  })

  it('произвольная строка (не "true"/"false") → ZodError, НЕ тихая коэрсия в false', () => {
    expect(() => SearchFiltersSchema.parse({ inStockOnly: 'yes' })).toThrow(ZodError)
  })

  it('isPrescriptionRequired отсутствует → undefined (истинно опционален, без дефолта)', () => {
    expect(SearchFiltersSchema.parse({}).isPrescriptionRequired).toBeUndefined()
  })

  it('isPrescriptionRequired="true"/true/"false" — транслируются корректно', () => {
    expect(SearchFiltersSchema.parse({ isPrescriptionRequired: 'true' }).isPrescriptionRequired).toBe(true)
    expect(SearchFiltersSchema.parse({ isPrescriptionRequired: true }).isPrescriptionRequired).toBe(true)
    expect(SearchFiltersSchema.parse({ isPrescriptionRequired: 'false' }).isPrescriptionRequired).toBe(false)
  })

  it('categoryId/priceMinDiram/priceMaxDiram коэрсятся из строки в целое неотрицательное', () => {
    const parsed = SearchFiltersSchema.parse({
      categoryId: '42',
      priceMinDiram: '100',
      priceMaxDiram: '5000',
    })
    expect(parsed).toMatchObject({ categoryId: 42, priceMinDiram: 100, priceMaxDiram: 5000 })
  })

  it('manufacturerName — непустая строка', () => {
    expect(SearchFiltersSchema.parse({ manufacturerName: 'Bayer' }).manufacturerName).toBe('Bayer')
    expect(() => SearchFiltersSchema.parse({ manufacturerName: '' })).toThrow(ZodError)
  })
})

describe('SearchQuerySchema.filters — вложенный объект дефолтится целиком (SearchQuery.filters не optional в порту)', () => {
  it('filters отсутствует в query — дефолт {} разворачивается в три false-флага', () => {
    expect(SearchQuerySchema.parse({}).filters).toEqual({
      inStockOnly: false,
      openNowOnly: false,
      is24x7Only: false,
    })
  })

  it('переданный filters проходит валидацию вложенной схемы', () => {
    expect(
      SearchQuerySchema.parse({ filters: { inStockOnly: true, categoryId: '7' } }).filters,
    ).toMatchObject({
      inStockOnly: true,
      categoryId: 7,
    })
  })
})

describe('PharmacyOfferSchema / SearchResultItemSchema / SearchResultPageSchema / SuggestItemSchema — зеркало порта', () => {
  const VALID_OFFER = {
    pharmacyId: 'pharmacy-1',
    pharmacyName: 'Аптека №1',
    priceDiram: 12_500,
    stockQuantity: 3,
    distanceMeters: 850,
    lastSyncedAt: '2026-08-31T10:00:00.000Z',
    isStale: false,
  }

  it('PharmacyOfferSchema принимает валидный оффер, distanceMeters/null допустим', () => {
    expect(PharmacyOfferSchema.parse(VALID_OFFER)).toEqual(VALID_OFFER)
    expect(PharmacyOfferSchema.parse({ ...VALID_OFFER, distanceMeters: null }).distanceMeters).toBeNull()
  })

  it('PharmacyOfferSchema отклоняет отрицательную цену (деньги — неотрицательные целые дирамы)', () => {
    expect(() => PharmacyOfferSchema.parse({ ...VALID_OFFER, priceDiram: -1 })).toThrow(ZodError)
  })

  it('SearchResultItemSchema принимает валидный товар с cheapestOffer=null (нет активных аптек)', () => {
    const item = {
      medicineId: 'med-1',
      tradeName: 'Парацетамол',
      innName: 'Парацетамол',
      dosageForm: 'таблетки',
      dosageStrength: '500 мг',
      imageUrl: null,
      isPrescriptionRequired: false,
      cheapestOffer: null,
      offersCountInRadius: 0,
      relevanceScore: 0.5,
    }
    expect(SearchResultItemSchema.parse(item)).toEqual(item)
  })

  it('SearchResultItemSchema принимает cheapestOffer как вложенный PharmacyOfferSchema', () => {
    const item = {
      medicineId: 'med-1',
      tradeName: 'Парацетамол',
      innName: 'Парацетамол',
      dosageForm: 'таблетки',
      dosageStrength: '500 мг',
      imageUrl: null,
      isPrescriptionRequired: false,
      cheapestOffer: VALID_OFFER,
      offersCountInRadius: 4,
      relevanceScore: 0.92,
    }
    expect(SearchResultItemSchema.parse(item).cheapestOffer).toEqual(VALID_OFFER)
  })

  it('SearchResultItemSchema отклоняет relevanceScore вне диапазона 0..1', () => {
    const invalid = {
      medicineId: 'med-1',
      tradeName: 'x',
      innName: 'x',
      dosageForm: 'x',
      dosageStrength: 'x',
      imageUrl: null,
      isPrescriptionRequired: false,
      cheapestOffer: null,
      offersCountInRadius: 0,
      relevanceScore: 1.5,
    }
    expect(() => SearchResultItemSchema.parse(invalid)).toThrow(ZodError)
  })

  it('SearchResultPageSchema принимает пустую страницу (форма NullSearchProvider)', () => {
    expect(SearchResultPageSchema.parse({ items: [], nextCursor: null, hasMore: false })).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    })
  })

  it('SuggestItemSchema принимает валидный пункт автодополнения', () => {
    const suggestion = {
      medicineId: 'med-1',
      tradeName: 'Парацетамол',
      innName: 'Парацетамол',
      matchedVia: 'prefix' as const,
    }
    expect(SuggestItemSchema.parse(suggestion)).toEqual(suggestion)
  })

  it('SuggestItemSchema отклоняет неизвестный matchedVia', () => {
    expect(() =>
      SuggestItemSchema.parse({
        medicineId: 'med-1',
        tradeName: 'x',
        innName: 'x',
        matchedVia: 'fuzzy',
      }),
    ).toThrow(ZodError)
  })
})
