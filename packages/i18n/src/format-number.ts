import { toIntlLocale } from './intl-locale.js'
import type { Locale } from './use-t.js'

/**
 * `format-number.ts` (DTJ-402 п.8, `SRS-UX-032`) — количество упаковок с разрядами через пробел
 * и локале-корректной плюрализацией.
 *
 * `ru`/`en` — три/две формы через `Intl.PluralRules`, стандартный движок JS, ICU-правила есть
 * для обоих кодов. `tj` — ОДНА неизменяемая форма с классификатором «дона», явной веткой
 * `if (locale === 'tj')`, НЕ полагаясь на то, что `Intl.PluralRules('tg')` вообще существует или
 * даёт «одна форма» (спецификация ECMA-402 не гарантирует наличие CLDR-данных для `tg` — движок
 * может отдать `undefined`/бросить, либо молча вернуть `'other'` без единой формы; в любом из этих
 * случаев полагаться на движок здесь неправильно, поэтому `tj` обходит `Intl.PluralRules`
 * полностью и никогда не передаёт `'tg'` в него для этой функции).
 *
 * Разряды числа — через `Intl.NumberFormat(toIntlLocale(locale))`: ICU уже даёт пробел как
 * группирующий разделитель для `ru`/`tg`, запятую для `en` — отдельной логики не требуется.
 *
 * Единственная считаемая сущность на этот тикет — упаковки (`package`); список расширяется по
 * мере появления новых считаемых сущностей в последующих тикетах (не блокирует DTJ-402).
 */
export type CountableUnit = 'package'

const RU_PLURAL_FORMS: Record<CountableUnit, Record<Intl.LDMLPluralRule, string>> = {
  package: {
    zero: 'упаковок',
    one: 'упаковка',
    two: 'упаковки',
    few: 'упаковки',
    many: 'упаковок',
    other: 'упаковки',
  },
}

const EN_PLURAL_FORMS: Record<CountableUnit, Record<'one' | 'other', string>> = {
  package: { one: 'package', other: 'packages' },
}

const TJ_CLASSIFIER: Record<CountableUnit, string> = {
  package: 'дона',
}

function formatGroupedCount(count: number, locale: Locale): string {
  return new Intl.NumberFormat(toIntlLocale(locale)).format(count)
}

/**
 * `formatNumber(count, locale, unit)` — сигнатура зафиксирована AC4 тикета DTJ-402.
 * `formatPluralized` (экспортируется бареллом как альтернативное имя, п.11 тикета) — тот же
 * контракт, без дублирования реализации.
 */
export function formatNumber(count: number, locale: Locale, unit: CountableUnit): string {
  const grouped = formatGroupedCount(count, locale)

  if (locale === 'tj') {
    return `${grouped} ${TJ_CLASSIFIER[unit]}`
  }

  if (locale === 'en') {
    const category = new Intl.PluralRules(toIntlLocale(locale)).select(count)
    const word = category === 'one' ? EN_PLURAL_FORMS[unit].one : EN_PLURAL_FORMS[unit].other
    return `${grouped} ${word}`
  }

  const category = new Intl.PluralRules(toIntlLocale(locale)).select(count)
  return `${grouped} ${RU_PLURAL_FORMS[unit][category]}`
}

export const formatPluralized = formatNumber
