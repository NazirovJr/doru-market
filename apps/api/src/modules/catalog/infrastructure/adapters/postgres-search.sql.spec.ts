/**
 * Unit-тест чистых функций `postgres-search.sql.ts` (DTJ-185, EP-06, R1).
 *
 * SQL-семантика на реальных данных (ранжирование, `EXPLAIN`-проверка индексов, tenant-изоляция)
 * проверяется интеграционным тестом `postgres-search.adapter.integration.spec.ts` (реальный
 * Postgres). Здесь — ФОРМА сгенерированного SQL: `isBarcodeShaped` (чистая функция), и что
 * построители запросов действительно содержат обязательные условия (SRS-CAT-055 narcotic-
 * исключение, tenant-скоуп, OR текстового поиска, точный `barcode`, сортировки) — рендерятся
 * через `PgDialect.sqlToQuery` (drizzle-orm), а не ручной обход `queryChunks` (надёжнее для
 * запроса с несколькими вложенными CTE, тот же результат, что реально уйдёт в `pg`).
 */
import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import {
  buildBarcodeSearchQuery,
  buildSearchQuery,
  DEFAULT_RELIABILITY_SCORE,
  FORCED_TEXT_RELEVANCE_FOR_BROWSING,
  isBarcodeShaped,
  SEARCH_TS_CONFIG,
  TRIGRAM_SIMILARITY_FLOOR,
  type SearchFiltersParams,
  type SearchQueryParams,
} from './postgres-search.sql.js'

const dialect = new PgDialect()

/** Текст SQL + позиционные параметры (`$1, $2, ...`) — тот же вид, что реально уходит в `pg`. */
function renderSql(query: SQL): { readonly sql: string; readonly params: readonly unknown[] } {
  return dialect.sqlToQuery(query)
}

const BASE_FILTERS: SearchFiltersParams = {
  inStockOnly: false,
  openNowOnly: false,
  is24x7Only: false,
}

function baseParams(overrides: Partial<SearchQueryParams> = {}): SearchQueryParams {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    filters: BASE_FILTERS,
    sort: 'relevance',
    limit: 20,
    offset: 0,
    ...overrides,
  }
}

describe('isBarcodeShaped (SRS-CAT-024 п.2)', () => {
  it.each(['12345678', '123456789012', '1234567890123', '12345678901234'])(
    'длина %s (8 либо 12-14 цифр) — штрихкод',
    (value) => {
      expect(isBarcodeShaped(value)).toBe(true)
    },
  )

  it.each(['1234567', '123456789', 'цытрамон', '123-456-789', ''])('%s — НЕ штрихкод', (value) => {
    expect(isBarcodeShaped(value)).toBe(false)
  })
})

describe('buildSearchQuery — режим text (SRS-CAT-021/024)', () => {
  const { sql: text } = renderSql(buildSearchQuery({ kind: 'text', text: 'цытрамон' }, baseParams()))

  it('SRS-CAT-055: исключает psychotropic/narcotic в candidates', () => {
    expect(text).toMatch(/control_category.*NOT IN \('psychotropic', 'narcotic'\)/)
  })

  it('SRS-CAT-021: OR из трёх условий (tsvector, trade_name trgm, inn_name trgm)', () => {
    expect(text).toMatch(/search_vector.*@@.*plainto_tsquery/)
    expect(text).toContain('trade_name" % ')
    expect(text).toContain('inn_name" % ')
  })

  it('SRS-CAT-013/014: tenant-скоуп присутствует (White-Label vs нейтральный)', () => {
    expect(text).toMatch(/tenant_id.*=.*tenants.*id/)
    expect(text).toContain('is_neutral')
  })

  it('candidates→offers→aggregated: три CTE, LIMIT/OFFSET на конце', () => {
    expect(text).toContain('candidates AS')
    expect(text).toContain('offers AS')
    expect(text).toContain('aggregated AS')
    expect(text).toMatch(/LIMIT \$\d+ OFFSET \$\d+/)
  })

  it('нет наличия — quantity > 0 обязателен в offers (SRS-CAT-010 п.2)', () => {
    expect(text).toContain('quantity" > 0')
  })
})

describe('buildSearchQuery — sort (тикет п.3: bypass композитной формулы)', () => {
  it.each([
    ['price_asc', /min_price.*ASC NULLS LAST/],
    ['price_desc', /min_price.*DESC NULLS LAST/],
    ['distance_asc', /nearest_distance.*ASC NULLS LAST/],
    ['relevance', /text_relevance.*DESC/],
  ] as const)('sort=%s → соответствующий ORDER BY', (sort, expected) => {
    const { sql: text } = renderSql(buildSearchQuery({ kind: 'text', text: 'x' }, baseParams({ sort })))
    expect(text).toMatch(expected)
  })
})

describe('buildSearchQuery — фильтры', () => {
  it('inStockOnly=true → INNER JOIN aggregated (не LEFT), медикамент без офферов исчезает (SRS-CAT-045)', () => {
    const { sql: text } = renderSql(
      buildSearchQuery({ kind: 'text', text: 'x' }, baseParams({ filters: { ...BASE_FILTERS, inStockOnly: true } })),
    )
    expect(text).toMatch(/(?<!LEFT )JOIN aggregated a ON a\.medicine_id = c\.id/)
  })

  it('inStockOnly=false (дефолт) → LEFT JOIN aggregated (SRS-CAT-045)', () => {
    const { sql: text } = renderSql(buildSearchQuery({ kind: 'text', text: 'x' }, baseParams()))
    expect(text).toContain('LEFT JOIN aggregated a ON a.medicine_id = c.id')
  })

  it('geo передан → гаверсинус-выражение и радиус-условие присутствуют, geo НЕ передан → их нет', () => {
    const withGeo = renderSql(
      buildSearchQuery({ kind: 'text', text: 'x' }, baseParams({ geo: { lat: 38.5, lon: 68.7, radiusMeters: 5000 } })),
    ).sql
    const withoutGeo = renderSql(buildSearchQuery({ kind: 'text', text: 'x' }, baseParams())).sql
    expect(withGeo).toContain('asin(sqrt(')
    expect(withoutGeo).not.toContain('asin(sqrt(')
  })

  it('categoryId/manufacturerName/isPrescriptionRequired/priceMin/priceMax — присутствуют, только если заданы', () => {
    const filtered = renderSql(
      buildSearchQuery(
        { kind: 'text', text: 'x' },
        baseParams({
          filters: {
            ...BASE_FILTERS,
            categoryId: 5,
            manufacturerName: 'Bayer',
            isPrescriptionRequired: true,
            priceMinDiram: 100,
            priceMaxDiram: 5000,
          },
        }),
      ),
    ).sql
    expect(filtered).toContain('category_id"')
    expect(filtered).toContain('lower(')
    expect(filtered).toContain('is_prescription_required"')
    expect(filtered).toContain('price" >=')
    expect(filtered).toContain('price" <=')
  })
})

describe('buildSearchQuery — режим browsing (SRS-CAT-023)', () => {
  it('нет текстового OR-условия, text_relevance форсирован FORCED_TEXT_RELEVANCE_FOR_BROWSING', () => {
    const { sql: text, params } = renderSql(buildSearchQuery({ kind: 'browsing' }, baseParams()))
    expect(text).not.toMatch(/plainto_tsquery/)
    expect(params).toContain(FORCED_TEXT_RELEVANCE_FOR_BROWSING)
  })
})

describe('buildBarcodeSearchQuery (SRS-CAT-024 п.2, TC-CAT-004/005)', () => {
  it('точное совпадение по barcode, БЕЗ tsvector/trgm фолбэка, LIMIT 1', () => {
    const { sql: text, params } = renderSql(buildBarcodeSearchQuery('4870123456789', baseParams()))
    expect(text).toContain('barcode" = ')
    expect(text).not.toMatch(/plainto_tsquery/)
    expect(text).not.toContain(' % ')
    expect(text).toMatch(/LIMIT \$\d+\s*$/)
    expect(params).toContain('4870123456789')
  })

  it('SRS-CAT-055: narcotic/psychotropic исключены даже в штрихкод-ветке', () => {
    const { sql: text } = renderSql(buildBarcodeSearchQuery('4870123456789', baseParams()))
    expect(text).toMatch(/control_category.*NOT IN \('psychotropic', 'narcotic'\)/)
  })
})

describe('Именованные константы — SRS-CAT-015/019/056 (C6, не магические числа в вызывающем коде)', () => {
  it('TRIGRAM_SIMILARITY_FLOOR = 0.20 (SRS-DB-017)', () => {
    expect(TRIGRAM_SIMILARITY_FLOOR).toBe(0.2)
  })

  it('DEFAULT_RELIABILITY_SCORE = 3.5 (§14.1)', () => {
    expect(DEFAULT_RELIABILITY_SCORE).toBe(3.5)
  })

  it('SEARCH_TS_CONFIG = tajik_ru (SRS-CAT-021, частичная реализация)', () => {
    expect(SEARCH_TS_CONFIG).toBe('tajik_ru')
  })
})
