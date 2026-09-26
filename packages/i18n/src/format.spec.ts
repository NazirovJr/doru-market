import { describe, expect, expectTypeOf, it } from 'vitest'
import { formatDate, formatRelativeDate, formatTime } from './format-date.js'
import { formatMoney } from './format-money.js'
import { formatNumber, formatPluralized } from './format-number.js'
import type { QuantityUnit } from './format-number.js'
import { formatPhone } from './format-phone.js'
import type { TranslationKey } from './use-t.js'

describe('formatMoney (SRS-UX-031)', () => {
  it('formats diram as somoni with the ru suffix', () => {
    expect(formatMoney(12050, 'ru')).toBe('120.50 сомони')
  })

  it('formats diram as somoni with the tj suffix', () => {
    expect(formatMoney(12050, 'tj')).toBe('120.50 сомонӣ')
  })

  it('formats diram as somoni with no suffix for en (no automatic TJS -> word translation)', () => {
    expect(formatMoney(12050, 'en')).toBe('120.50')
  })

  it('divides diram by 100 exactly (integer diram in, no float leakage)', () => {
    expect(formatMoney(100, 'ru')).toBe('1.00 сомони')
    expect(formatMoney(0, 'ru')).toBe('0.00 сомони')
  })

  it('rejects a non-integer amountDiram (AGENTS.md rule 6 — money is never float)', () => {
    expect(() => formatMoney(120.5, 'ru')).toThrow(RangeError)
  })

  it('formats a negative amount with a leading minus', () => {
    expect(formatMoney(-12050, 'ru')).toBe('-120.50 сомони')
  })

  it('groups thousands in the integer part with a plain space', () => {
    expect(formatMoney(123456700, 'ru')).toBe('1 234 567.00 сомони')
  })
})

describe('formatDate/formatTime (SRS-UX-031)', () => {
  it('formats a full date as ДД.ММ.ГГГГ', () => {
    expect(formatDate(new Date(2026, 7, 27))).toBe('27.08.2026')
  })

  it('formats time as ЧЧ:ММ, 24-hour, no AM/PM', () => {
    expect(formatTime(new Date(2026, 7, 27, 14, 32))).toBe('14:32')
    expect(formatTime(new Date(2026, 7, 27, 0, 5))).toBe('00:05')
  })
})

describe('formatRelativeDate — boundary at exactly 7 days (SRS-UX-031)', () => {
  const now = new Date(2026, 7, 27, 10, 0)

  it('returns "today" label for the same day', () => {
    expect(formatRelativeDate(new Date(2026, 7, 27, 3, 0), now, 'ru')).toBe('сегодня')
  })

  it('returns "yesterday" label for 1 day back', () => {
    expect(formatRelativeDate(new Date(2026, 7, 26), now, 'ru')).toBe('вчера')
  })

  it('returns "N days ago" (pluralized) for 2..6 days back', () => {
    expect(formatRelativeDate(new Date(2026, 7, 25), now, 'ru')).toBe('2 дня назад')
    expect(formatRelativeDate(new Date(2026, 7, 21), now, 'ru')).toBe('6 дней назад')
  })

  it('falls back to the full date at exactly 7 days back (boundary excluded from "N days ago")', () => {
    expect(formatRelativeDate(new Date(2026, 7, 20), now, 'ru')).toBe(formatDate(new Date(2026, 7, 20)))
  })

  it('falls back to the full date further in the past', () => {
    expect(formatRelativeDate(new Date(2026, 6, 1), now, 'ru')).toBe(formatDate(new Date(2026, 6, 1)))
  })

  it('falls back to the full date for a future date (defensive — never negative "days ago")', () => {
    expect(formatRelativeDate(new Date(2026, 7, 28), now, 'ru')).toBe(formatDate(new Date(2026, 7, 28)))
  })
})

describe('formatNumber — ru plural forms (SRS-UX-032)', () => {
  it.each([
    [1, '1 упаковка'],
    [2, '2 упаковки'],
    [5, '5 упаковок'],
    [11, '11 упаковок'],
    [21, '21 упаковка'],
  ])('formatNumber(%i, "ru", "package") === %j', (count, expected) => {
    expect(formatNumber(count, 'ru', 'package')).toBe(expected)
  })

  it('groups thousands with a space for large counts', () => {
    // `Intl.NumberFormat('ru')` группирует разряды неразрывным пробелом (U+00A0), не обычным.
    expect(formatNumber(1250, 'ru', 'piece')).toBe('1 250 шт.')
  })
})

describe('formatNumber — en plural forms (one/other)', () => {
  it('uses the singular form for count === 1', () => {
    expect(formatNumber(1, 'en', 'package')).toBe('1 package')
  })

  it('uses the plural "other" form for count !== 1', () => {
    expect(formatNumber(2, 'en', 'package')).toBe('2 packages')
    expect(formatNumber(0, 'en', 'package')).toBe('0 packages')
  })
})

describe('formatPluralized / formatNumber — unknown key fallback', () => {
  it('falls back to the raw keyPrefix when neither the category nor the "other" key exists', () => {
    expect(formatPluralized(1, 'quantity.does_not_exist', 'ru')).toBe('quantity.does_not_exist')
  })

  it('falls back gracefully for an unknown unit-like prefix via formatNumber-shaped call', () => {
    expect(formatPluralized(5, 'quantity.does_not_exist', 'tj')).toBe('quantity.does_not_exist')
  })

  it('formatNumber falls back to the raw key prefix for an unregistered unit (defensive path)', () => {
    // `unit` типизирован `QuantityUnit`, но защитная ветка (`?? keyPrefix`) существует и на
    // случай данных, обошедших типы (например, значение пришло из внешнего источника/API) —
    // проверяем её явным приведением типа, а не полагаемся, что она недостижима.
    expect(formatNumber(3, 'ru', 'bottle' as unknown as QuantityUnit)).toBe('quantity.bottle')
  })
})

describe('formatNumber — tj always single form (SRS-UX-032)', () => {
  it('uses the same grammatical form for 1 and 5 (no ru-like declension)', () => {
    const one = formatNumber(1, 'tj', 'package')
    const five = formatNumber(5, 'tj', 'package')

    expect(one).toBe('1 дона қуттӣ')
    expect(five).toBe('5 дона қуттӣ')
    // Одна и та же неизменяемая структура «число + классификатор» — отличается только число.
    expect(one.replace('1', '5')).toBe(five)
  })

  it('formatPluralized also stays on the same single form for tj regardless of count', () => {
    // Одна и та же неизменяемая структура «число + классификатор» для любого количества.
    expect(formatPluralized(1, 'quantity.piece', 'tj').replace('1', '')).toBe(
      formatPluralized(11, 'quantity.piece', 'tj').replace('11', ''),
    )
  })
})

describe('formatPhone — normalizes to +992 XX XXX XX XX (SRS-UX-031/SRS-DOM-069)', () => {
  it('formats a full E.164 number', () => {
    expect(formatPhone('+992901234567')).toBe('+992 90 123 45 67')
  })

  it('formats a number without the leading +', () => {
    expect(formatPhone('992901234567')).toBe('+992 90 123 45 67')
  })

  it('is identical across locales — the function does not take a locale parameter at all', () => {
    expectTypeOf(formatPhone).parameters.toEqualTypeOf<[string]>()
  })

  it('formats a partial/incomplete number without throwing', () => {
    expect(formatPhone('+99290')).toBe('+992 90')
  })

  it('returns just the prefix for an empty/no-digit input', () => {
    expect(formatPhone('')).toBe('+992')
    expect(formatPhone('abc')).toBe('+992')
  })

  it('formats local digits without a country code prefix (only 9 national digits)', () => {
    expect(formatPhone('901234567')).toBe('+992 90 123 45 67')
  })
})

describe('TranslationKey — compile-time key guard (DTJ-402 acceptance criterion 5)', () => {
  it('accepts a real dictionary key at the type level', () => {
    expectTypeOf<'ux.error.otp_locked'>().toExtend<TranslationKey>()
  })

  it('rejects a non-existent key at compile time (checked by tsc, not at runtime)', () => {
    // @ts-expect-error — 'ux.does.not.exist' — не ключ ни одного из трёх словарей; строка ниже
    // ОБЯЗАНА не компилироваться, иначе `tsc` падает на "Unused '@ts-expect-error' directive".
    const bogus: TranslationKey = 'ux.does.not.exist'
    expect(typeof bogus).toBe('string')
  })
})
