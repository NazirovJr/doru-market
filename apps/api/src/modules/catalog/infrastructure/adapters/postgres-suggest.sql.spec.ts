/**
 * Unit-тест чистых функций `postgres-suggest.sql.ts` (DTJ-186, EP-06, R1).
 *
 * SQL-семантика (UNION/дедуп/видимость на реальных данных) проверяется интеграционным тестом
 * `postgres-search-suggest.adapter.integration.spec.ts` (реальный Postgres). Здесь — только
 * логика, не требующая БД: выбор ветки по длине префикса (`SRS-CAT-029`) и генерация
 * приоритетного `CASE`-выражения из `MATCHED_VIA_PRIORITY` (единственный источник истины,
 * см. JSDoc файла — тест-план DTJ-186 «дедуп/приоритет matchedVia можно покрыть unit-тестом на
 * чистой функции сборки приоритета, если такая функция выделена отдельно»).
 */
import { describe, expect, it } from 'vitest'
import {
  isSuggestShortPrefix,
  MATCHED_VIA_PRIORITY,
  matchedViaPriorityCase,
  SUGGEST_SHORT_PREFIX_THRESHOLD,
} from './postgres-suggest.sql.js'

describe('isSuggestShortPrefix (SRS-CAT-029)', () => {
  it('length 0..2 — короткая (префиксная) ветка', () => {
    expect(isSuggestShortPrefix('')).toBe(true)
    expect(isSuggestShortPrefix('н')).toBe(true)
    expect(isSuggestShortPrefix('но')).toBe(true)
  })

  it('length >= 3 — длинная (trigram) ветка', () => {
    expect(isSuggestShortPrefix('но-')).toBe(false)
    expect(isSuggestShortPrefix('парац')).toBe(false)
  })

  it('порог совпадает с именованной константой (C6, не магическое число)', () => {
    expect(SUGGEST_SHORT_PREFIX_THRESHOLD).toBe(3)
    expect(isSuggestShortPrefix('a'.repeat(SUGGEST_SHORT_PREFIX_THRESHOLD - 1))).toBe(true)
    expect(isSuggestShortPrefix('a'.repeat(SUGGEST_SHORT_PREFIX_THRESHOLD))).toBe(false)
  })
})

describe('MATCHED_VIA_PRIORITY (SRS-CAT-028: prefix > trigram > inn)', () => {
  it('порядок приоритета строго возрастает prefix < trigram < inn', () => {
    expect(MATCHED_VIA_PRIORITY.prefix).toBeLessThan(MATCHED_VIA_PRIORITY.trigram)
    expect(MATCHED_VIA_PRIORITY.trigram).toBeLessThan(MATCHED_VIA_PRIORITY.inn)
  })
})

describe('matchedViaPriorityCase — генерация SQL CASE из MATCHED_VIA_PRIORITY', () => {
  it('содержит WHEN для каждого значения matchedVia с корректным приоритетом', () => {
    const rendered = matchedViaPriorityCase()
    const text = renderSqlText(rendered)
    expect(text).toContain("WHEN 'prefix' THEN 0")
    expect(text).toContain("WHEN 'trigram' THEN 1")
    expect(text).toContain("WHEN 'inn' THEN 2")
  })
})

/** Достаёт текст сгенерированного `sql.raw(...)` для проверки без реального подключения к БД. */
function renderSqlText(value: unknown): string {
  const queryChunks = (value as { readonly queryChunks?: readonly unknown[] }).queryChunks
  if (Array.isArray(queryChunks)) {
    return queryChunks
      .map((chunk) => (chunk as { readonly value?: readonly string[] }).value?.join('') ?? '')
      .join('')
  }
  return JSON.stringify(value)
}
