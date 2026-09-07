import { useT, type Locale } from './use-t.js'

/**
 * `format-date.ts` (DTJ-402 п.7, `SRS-UX-031`) — три функции по таблице форматов:
 *   - `formatDate`         — полная дата `ДД.ММ.ГГГГ`, ОДИНАКОВО во всех локалях (таблица
 *                             `SRS-UX-031` даёт один и тот же пример для `ru` и `tj` — это не
 *                             совпадение, а фиксированный европейский числовой формат для всех
 *                             трёх локалей платформы, не локале-зависимый порядок компонентов).
 *   - `formatTime`         — `ЧЧ:ММ`, 24-часовой формат ВСЕГДА, без AM/PM.
 *   - `formatRelativeDate` — «сегодня/вчера/N дней назад» для разницы < 7 дней, иначе полная дата.
 *     Граница РОВНО в 7 дней — уже полная дата, не «7 дней назад» (см. `format.spec.ts`).
 *
 * `now` — явный параметр (не `Date.now()` внутри), чтобы функция оставалась чистой и
 * детерминированно тестируемой без подмены глобального времени.
 */
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const MILLISECONDS_PER_SECOND = 1000
const MILLISECONDS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND
const RELATIVE_BOUNDARY_DAYS = 7
const PAD_WIDTH = 2

function pad2(value: number): string {
  return value.toString().padStart(PAD_WIDTH, '0')
}

export function formatDate(date: Date): string {
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear().toString()}`
}

export function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function diffInCalendarDays(date: Date, now: Date): number {
  return Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / MILLISECONDS_PER_DAY)
}

export function formatRelativeDate(date: Date, locale: Locale, now: Date = new Date()): string {
  const { t } = useT(locale)
  const daysAgo = diffInCalendarDays(date, now)
  const time = formatTime(date)

  if (daysAgo === 0) {
    return `${t('common.date.today')}, ${time}`
  }
  if (daysAgo === 1) {
    return `${t('common.date.yesterday')}, ${time}`
  }
  if (daysAgo > 1 && daysAgo < RELATIVE_BOUNDARY_DAYS) {
    return `${t('common.date.days_ago', { count: daysAgo })}, ${time}`
  }

  return formatDate(date)
}
