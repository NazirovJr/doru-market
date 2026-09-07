import { toIntlLocale } from './intl-locale.js'
import { useT, type Locale } from './use-t.js'

/**
 * `formatMoney` (DTJ-402 п.6, `SRS-UX-031`) — целые дирамы → отображаемая строка сомони.
 *
 * Деньги — целые дирамы, деление на 100 только на последнем шаге для отображения (правило 6
 * AGENTS.md) — эта функция и есть тот последний шаг, дальше в арифметику не участвует.
 *
 * Суффикс валюты — ключ словаря `currency.somoni_suffix`, НЕ встроенный ISO-код `Intl.NumberFormat
 * ({ style: 'currency', currency: 'TJS' })` — `TJS` не переводится движками автоматически в слово
 * «сомони»/«сомонӣ» (`SRS-UX-031`). Для `en` суффикс — пустая строка (см. словарь).
 */
const DIRAM_PER_SOMONI = 100
const SOMONI_FRACTION_DIGITS = 2

export function formatMoney(amountDiram: number, locale: Locale): string {
  const somoni = amountDiram / DIRAM_PER_SOMONI
  const formattedNumber = new Intl.NumberFormat(toIntlLocale(locale), {
    minimumFractionDigits: SOMONI_FRACTION_DIGITS,
    maximumFractionDigits: SOMONI_FRACTION_DIGITS,
  }).format(somoni)

  const suffix = useT(locale).t('currency.somoni_suffix')
  return suffix === '' ? formattedNumber : `${formattedNumber} ${suffix}`
}
