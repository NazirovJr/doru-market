/**
 * `formatMoney` (DTJ-402, `SRS-UX-031`, AGENTS.md правило 6) — целые дирамы → строка сомони для
 * отображения. Деление на 100 — только на этом, последнем шаге форматирования (промежуточная
 * арифметика над `*Diram`-полями остаётся целочисленной за пределами этого файла).
 *
 * Суффикс валюты — ключ словаря `currency.somoni_suffix` (`сомони`/`сомонӣ`/пусто для `en`), а НЕ
 * встроенный ISO-код `Intl.NumberFormat({ style: 'currency', currency: 'TJS' })` — `TJS` не
 * переводится автоматически движками в слово «сомони»/«сомонӣ» (`SRS-UX-031`).
 *
 * Числовая часть форматируется ВРУЧНУЮ (`N.NN`, точка как десятичный разделитель, разряды через
 * пробел), а НЕ через `Intl.NumberFormat(toIntlLocale(locale))` — канонические примеры
 * `SRS-UX-031` («120.50 сомони» для `ru`, «120.50 сомонӣ» для `tj») используют ОДИНАКОВУЮ точку
 * как десятичный разделитель для обеих локалей, тогда как реальный `Intl.NumberFormat('ru')`
 * отдал бы запятую («120,50») — локализованная пунктуация чисел здесь НЕ то, что специфицировано
 * для денежного формата (проверено `node -e` перед написанием — расхождение зафиксировано, а не
 * предположено).
 */
import en from './dictionaries/en.json' with { type: 'json' }
import ru from './dictionaries/ru.json' with { type: 'json' }
import tj from './dictionaries/tj.json' with { type: 'json' }
import type { Locale } from './use-t.js'

const DIRAM_PER_SOMONI = 100
const SOMONI_FRACTION_DIGITS = 2
const THOUSANDS_GROUP_PATTERN = /\B(?=(\d{3})+(?!\d))/g

const SOMONI_SUFFIX_BY_LOCALE: Readonly<Record<Locale, string>> = {
  tj: tj['currency.somoni_suffix'],
  ru: ru['currency.somoni_suffix'],
  en: en['currency.somoni_suffix'],
}

function groupThousands(integerDigits: string): string {
  return integerDigits.replace(THOUSANDS_GROUP_PATTERN, ' ')
}

/**
 * Given `amountDiram` (целое число дирам — 1 TJS = 100 дирам) и `locale`, возвращает
 * отформатированную строку суммы в сомони с локализованным суффиксом валюты.
 *
 * @throws {RangeError} если `amountDiram` не целое число (правило 6 AGENTS.md — деньги никогда
 *   не float; нецелое значение на входе форматтера — признак утечки float выше по стеку).
 */
export function formatMoney(amountDiram: number, locale: Locale): string {
  if (!Number.isInteger(amountDiram)) {
    throw new RangeError(`formatMoney: amountDiram must be an integer (diram), got ${String(amountDiram)}`)
  }

  const somoni = amountDiram / DIRAM_PER_SOMONI
  const isNegative = somoni < 0
  const [integerPart, fractionPart] = Math.abs(somoni).toFixed(SOMONI_FRACTION_DIGITS).split('.')
  const numberPart = `${isNegative ? '-' : ''}${groupThousands(integerPart ?? '0')}.${fractionPart ?? '00'}`

  const suffix = SOMONI_SUFFIX_BY_LOCALE[locale]
  return suffix.length > 0 ? `${numberPart} ${suffix}` : numberPart
}
