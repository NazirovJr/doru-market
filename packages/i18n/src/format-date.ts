/**
 * `formatDate`/`formatRelativeDate`/`formatTime` (DTJ-402, `SRS-UX-031`) — дата/время для
 * отображения:
 *
 * - Полная дата — ВСЕГДА `ДД.ММ.ГГГГ`, независимо от локали (таблица `SRS-UX-031` показывает
 *   идентичный формат для `ru`/`tj` — форматируется вручную через `padStart`, а не через
 *   `Intl.DateTimeFormat(locale)`, чтобы `en`-локаль не откатилась на `MM/DD/YYYY`).
 * - Относительная дата (<7 дней) — «сегодня/вчера/N дней назад» локализованными ключами
 *   (`date.today`/`date.yesterday`/`date.days_ago.*`, через `formatPluralized`), граница РОВНО
 *   7 дней — дальше используется полная дата.
 * - Время — ВСЕГДА `ЧЧ:ММ`, 24-часовой формат (не 12-часовой AM/PM — не принят в РТ), тоже вручную
 *   через `padStart`, не через `Intl.DateTimeFormat` (та же причина: избегаем непредсказуемого
 *   отката на 12-часовой формат под `en`).
 *
 * `now`/`referenceDate` — ВСЕГДА явный параметр, не читается из `Date.now()` внутри модуля:
 * функции этого файла — чистые (тестируемость, детерминированность границы «7 дней»).
 */
import en from './dictionaries/en.json' with { type: 'json' }
import ru from './dictionaries/ru.json' with { type: 'json' }
import tj from './dictionaries/tj.json' with { type: 'json' }
import { formatPluralized } from './format-number.js'
import type { Locale } from './use-t.js'

const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const MILLISECONDS_PER_SECOND = 1000
const MILLISECONDS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND
const RELATIVE_BOUNDARY_DAYS = 7
const YESTERDAY_DAYS_AGO = 1
const PAD_WIDTH = 2
const PAD_CHAR = '0'

function pad2(value: number): string {
  return String(value).padStart(PAD_WIDTH, PAD_CHAR)
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Полная дата `ДД.ММ.ГГГГ`, одинаковая во всех локалях (`SRS-UX-031`). */
export function formatDate(date: Date): string {
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${String(date.getFullYear())}`
}

/** Время `ЧЧ:ММ`, 24-часовой формат, одинаковый во всех локалях (`SRS-UX-031`). */
export function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/**
 * Given `date` и `referenceDate` («сейчас»), возвращает «сегодня»/«вчера»/«N дней назад» для
 * разницы < 7 дней, иначе полную дату `formatDate(date)` (граница РОВНО 7 дней — 7-й день уже
 * полная дата, не «7 дней назад»).
 */
export function formatRelativeDate(date: Date, referenceDate: Date, locale: Locale): string {
  const diffDays = Math.round(
    (startOfDay(referenceDate).getTime() - startOfDay(date).getTime()) / MILLISECONDS_PER_DAY,
  )

  if (diffDays < 0 || diffDays >= RELATIVE_BOUNDARY_DAYS) {
    return formatDate(date)
  }

  if (diffDays === 0) {
    return DAY_LABEL_TODAY[locale]
  }

  if (diffDays === YESTERDAY_DAYS_AGO) {
    return DAY_LABEL_YESTERDAY[locale]
  }

  return formatPluralized(diffDays, 'date.days_ago', locale)
}

// Ключи `date.today`/`date.yesterday` — не плюрализуются (единственная форма), поэтому читаются
// напрямую словарём, без обращения к `formatPluralized`.
const DAY_LABEL_TODAY: Readonly<Record<Locale, string>> = {
  tj: tj['date.today'],
  ru: ru['date.today'],
  en: en['date.today'],
}

const DAY_LABEL_YESTERDAY: Readonly<Record<Locale, string>> = {
  tj: tj['date.yesterday'],
  ru: ru['date.yesterday'],
  en: en['date.yesterday'],
}
