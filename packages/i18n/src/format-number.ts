/**
 * `formatNumber`/`formatPluralized` (DTJ-402, `SRS-UX-031`/`SRS-UX-032`) — форматирование
 * количества с разрядами через пробел (от 4 значных цифр) и согласование числительного с
 * существительным по локали:
 *
 * - `ru`/`en` — три формы `one/few/many` через `Intl.PluralRules` (движок реально умеет считать
 *   ru-плюрализацию правильно: 1/21/31… → one, 2..4/22..24… → few, 5..20/25..30… → many).
 * - `tj` — ОДНА неизменяемая форма с классификатором («дона»/«адад»), реализовано ЯВНОЙ веткой
 *   `if (locale === 'tj')`, а не доверием к тому, что `Intl.PluralRules('tg')` даст 1 форму сам —
 *   движок может вовсе не иметь плюральных правил для `tg`, и детерминированность здесь важнее
 *   «магии» библиотеки (риски тикета, п. «`i18next-icu` может не иметь встроенных CLDR-правил»).
 *
 * Словарь хранит `tj`-строки идентичными во всех четырёх слотах (`one/few/many/other`) — это
 * сделано ТОЛЬКО ради паритета набора ключей между локалями (`dictionary key parity`-тест), а не
 * потому что для `tj` реально существует 4 формы; какой слот выбрать для `tj`, не имеет значения
 * по построению словаря — но код всё равно НЕ полагается на это и жёстко берёт `'one'`.
 */
import en from './dictionaries/en.json' with { type: 'json' }
import ru from './dictionaries/ru.json' with { type: 'json' }
import tj from './dictionaries/tj.json' with { type: 'json' }
import { toIntlLocale } from './intl-locale.js'
import type { Locale } from './use-t.js'

type Dictionary = Readonly<Record<string, string>>

const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = { tj, ru, en }

/** Плейсхолдер вида `{param}` — тот же синтаксис, что в `use-t.ts` (DTJ-004 п.3). */
const PARAM_PATTERN = /\{(\w+)\}/g

type PluralCategory = 'one' | 'few' | 'many' | 'other'

const KNOWN_PLURAL_CATEGORIES: ReadonlySet<string> = new Set<PluralCategory>(['one', 'few', 'many', 'other'])

function interpolate(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(PARAM_PATTERN, (placeholder: string, paramName: string): string => {
    const value = params[paramName]
    return value === undefined ? placeholder : String(value)
  })
}

/**
 * Категория числительного по локали. `tj` — всегда `'one'` (единственная форма, `SRS-UX-032`),
 * явной веткой, без обращения к `Intl.PluralRules` вовсе.
 */
function resolvePluralCategory(locale: Locale, count: number): PluralCategory {
  if (locale === 'tj') {
    return 'one'
  }

  const category = new Intl.PluralRules(toIntlLocale(locale)).select(count)
  return KNOWN_PLURAL_CATEGORIES.has(category) ? (category as PluralCategory) : 'other'
}

/**
 * Given `keyPrefix` (например `quantity.package`), возвращает плюрализованную строку с
 * подставленным `{count}` (разряды НЕ форматируются — сырое число, см. `formatNumber` для
 * версии с разрядами через пробел).
 */
export function formatPluralized(count: number, keyPrefix: string, locale: Locale): string {
  const category = resolvePluralCategory(locale, count)
  const dictionary = DICTIONARIES[locale]
  const template = dictionary[`${keyPrefix}.${category}`] ?? dictionary[`${keyPrefix}.other`] ?? keyPrefix

  return interpolate(template, { count })
}

export type QuantityUnit = 'package' | 'piece'

/**
 * Given количество и единицу (`package`/`piece`), возвращает строку с разрядами через пробел
 * (`Intl.NumberFormat`, `SRS-UX-031` — «1 250 шт.») и правильно согласованным существительным по
 * локали (`SRS-UX-032`).
 */
export function formatNumber(count: number, locale: Locale, unit: QuantityUnit): string {
  const category = resolvePluralCategory(locale, count)
  const dictionary = DICTIONARIES[locale]
  const keyPrefix = `quantity.${unit}`
  const template = dictionary[`${keyPrefix}.${category}`] ?? dictionary[`${keyPrefix}.other`] ?? keyPrefix
  const groupedCount = new Intl.NumberFormat(toIntlLocale(locale)).format(count)

  return interpolate(template, { count: groupedCount })
}
