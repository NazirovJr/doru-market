import { describe, expect, it } from 'vitest'
import { formatDate, formatRelativeDate, formatTime } from './format-date.js'
import { formatMoney } from './format-money.js'
import { formatNumber } from './format-number.js'
import { formatPhone } from './format-phone.js'

describe('formatMoney', () => {
  // ru/tj форматируются по-кириллически — запятая как разделитель дробной части (см.
  // `intl-locale.spec.ts`), НЕ точка — это не опечатка теста.
  it('formats diram as somoni with the ru locale-specific suffix', () => {
    expect(formatMoney(12050, 'ru')).toBe('120,50 сомони')
  })

  it('formats diram as somoni with the tj locale-specific suffix', () => {
    expect(formatMoney(12050, 'tj')).toBe('120,50 сомонӣ')
  })

  it('formats diram as a bare number for en (no ISO code, empty suffix)', () => {
    expect(formatMoney(12050, 'en')).toBe('120.50')
  })

  it('always shows exactly 2 fraction digits, without rounding to whole somoni', () => {
    expect(formatMoney(100, 'en')).toBe('1.00')
  })
})

describe('formatDate / formatTime', () => {
  it('formatDate renders DD.MM.YYYY', () => {
    expect(formatDate(new Date(2026, 7, 27))).toBe('27.08.2026')
  })

  it('formatTime renders 24-hour HH:MM, never AM/PM', () => {
    expect(formatTime(new Date(2026, 7, 27, 14, 32))).toBe('14:32')
  })

  it('formatDate pads single-digit day/month', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('05.01.2026')
  })
})

describe('formatRelativeDate — boundary at exactly 7 days', () => {
  const now = new Date(2026, 7, 27, 10, 0)

  it('renders "today, HH:MM" for the same calendar day', () => {
    const date = new Date(2026, 7, 27, 14, 32)
    expect(formatRelativeDate(date, 'ru', now)).toBe('сегодня, 14:32')
  })

  it('renders "yesterday, HH:MM" for 1 day ago', () => {
    const date = new Date(2026, 7, 26, 9, 0)
    expect(formatRelativeDate(date, 'ru', now)).toBe('вчера, 09:00')
  })

  it('renders "N days ago, HH:MM" for 2..6 days ago', () => {
    const date = new Date(2026, 7, 22, 9, 0)
    expect(formatRelativeDate(date, 'ru', now)).toBe('5 дней назад, 09:00')
  })

  it('renders the full date (not relative) at exactly the 7-day boundary', () => {
    const date = new Date(2026, 7, 20, 9, 0)
    expect(formatRelativeDate(date, 'ru', now)).toBe('20.08.2026')
  })

  it('renders the full date for anything older than 7 days', () => {
    const date = new Date(2026, 6, 1, 9, 0)
    expect(formatRelativeDate(date, 'ru', now)).toBe('01.07.2026')
  })

  it('uses the tj wording for relative labels', () => {
    const date = new Date(2026, 7, 27, 14, 32)
    expect(formatRelativeDate(date, 'tj', now)).toBe('имрӯз, 14:32')
  })
})

describe('formatNumber — ru plural forms (edge cases few/many boundary)', () => {
  it.each([
    [1, '1 упаковка'],
    [2, '2 упаковки'],
    [5, '5 упаковок'],
    [11, '11 упаковок'],
    [21, '21 упаковка'],
  ])('formatNumber(%i, "ru", "package") -> %s', (count, expected) => {
    expect(formatNumber(count, 'ru', 'package')).toBe(expected)
  })
})

describe('formatNumber — en plural forms', () => {
  it('renders singular for 1', () => {
    expect(formatNumber(1, 'en', 'package')).toBe('1 package')
  })

  it('renders plural for anything else', () => {
    expect(formatNumber(5, 'en', 'package')).toBe('5 packages')
  })
})

describe('formatNumber — tj always uses a single invariant form', () => {
  it('does not change grammatical structure between 1 and 5', () => {
    expect(formatNumber(1, 'tj', 'package')).toBe('1 дона')
    expect(formatNumber(5, 'tj', 'package')).toBe('5 дона')
  })

  it('still groups large counts with the locale thousands separator', () => {
    // ICU для `tg` группирует разряды через U+00A0 (неразрывный пробел), не обычный пробел.
    expect(formatNumber(1250, 'tj', 'package')).toBe('1 250 дона')
  })
})

describe('formatPhone — normalizes to +992 XX XXX XX XX display mask', () => {
  it('formats a plain E.164-like string with no separators', () => {
    expect(formatPhone('+992901234567')).toBe('+992 90 123 45 67')
  })

  it('formats a national number without the leading country code', () => {
    expect(formatPhone('901234567')).toBe('+992 90 123 45 67')
  })

  it('strips spaces/dashes/parentheses before masking', () => {
    expect(formatPhone('+992 (90) 123-45-67')).toBe('+992 90 123 45 67')
  })
})
