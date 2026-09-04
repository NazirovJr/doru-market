/**
 * Чистые хелперы `CashCommissionAggregationJob` (DTJ-251): TZ-арифметика Asia/Dushanbe +
 * построение детерминированного ключа идемпотентности (`deterministicEventId`, см. её JSDoc
 * ниже) — сгруппированы в одном файле как некрупные функции без общего состояния (C17
 * ограничивает один класс/компонент на файл, не отдельные функции — тот же приём, что
 * `checkout.util.ts`, содержащий много независимых хелперов).
 *
 * Хелперы TZ-арифметики Asia/Dushanbe. Адаптация
 * `toDushanbeYYMMDD` (`apps/api/src/modules/orders/application/checkout/checkout.util.ts:159`,
 * EP-09/DTJ-227) под «начало дня/недели», буквально по тексту тикета «Риски»: «использовать ту
 * же... что уже применяется другими джобами с TZ-логикой... для консистентности». Скопировано,
 * не импортировано — `apps/worker` физически не может импортировать `apps/api` (нет пути между
 * `apps/*` в этой монорепе, см. JSDoc `escrow-reconciliation.job.ts`), тот же класс
 * необходимого дублирования через границу деплоя, что `EscrowLedgerImbalanceMetric`.
 *
 * `ESCROW_RECONCILIATION_TZ` (`escrow-reconciliation.constants.ts`) — НЕ прецедент для этой
 * арифметики (проверено, см. JSDoc координатора задания): используется ТОЛЬКО как `tz` BullMQ
 * cron-расписания (когда джоба ЗАПУСКАЕТСЯ), не для вычисления границ периода внутри логики.
 *
 * Asia/Dushanbe — фиксированный UTC+5, БЕЗ перехода на летнее время (Таджикистан, действующий
 * факт на 2026 год) — офсет безопасно вычисляется ОДНИМ обращением к `Intl` на вызов (не
 * пересчитывается на каждый день диапазона), что было бы обязательно при наличии DST.
 */
import { createHash } from 'node:crypto'

const DUSHANBE_TZ = 'Asia/Dushanbe'
const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
/** ISO-неделя (Пн..Вс) — `Date.getUTCDay()`: 0=Вс..6=Сб, до понедельника (1) столько дней назад. */
const DAYS_FROM_SUNDAY_TO_MONDAY = 6
const DAYS_PER_WEEK = 7
/** UUID-паттерн (8-4-4-4-12) — 32 hex-символа, см. JSDoc `deterministicEventId`. */
const HEX_CHARS_FOR_UUID = 32
/** Границы (кумулятивные длины) групп канонического UUID-паттерна 8-4-4-4-12. */
const UUID_GROUP_1_END = 8
const UUID_GROUP_2_END = 12
const UUID_GROUP_3_END = 16
const UUID_GROUP_4_END = 20

interface DushanbeDateParts {
  readonly year: number
  readonly month: number
  readonly day: number
}

function dushanbeDateParts(date: Date): DushanbeDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: DUSHANBE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    date,
  )
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** Разница (минуты) между Dushanbe-настенным временем и UTC для ТОГО ЖЕ инстанта — см. JSDoc файла про фиксированный офсет. */
function dushanbeOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DUSHANBE_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUtcMillis = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtcMillis - date.getTime()) / MS_PER_MINUTE)
}

/** UTC-инстант полуночи Asia/Dushanbe календарного дня, которому принадлежит `date`. */
export function startOfDushanbeDay(date: Date): Date {
  const { year, month, day } = dushanbeDateParts(date)
  const utcMidnight = Date.UTC(year, month - 1, day)
  return new Date(utcMidnight - dushanbeOffsetMinutes(date) * MS_PER_MINUTE)
}

/** Понедельник 00:00 Asia/Dushanbe ISO-недели, которой принадлежит `date` (SRS-PAY-036: расчётный период). */
export function startOfDushanbeWeek(date: Date): Date {
  const dayStart = startOfDushanbeDay(date)
  // `dayStart` — УЖЕ инстант Dushanbe-полуночи своего дня, поэтому его собственные Y-M-D
  // (снова через Intl, не переиспользуем `date`) точно совпадают с календарным днём Dushanbe;
  // `Date.UTC(...).getUTCDay()` — день недели ЭТОЙ календарной даты, вне зависимости от TZ
  // (день недели — чистая функция от Y-M-D, см. JSDoc `startOfDushanbeDay`).
  const { year, month, day } = dushanbeDateParts(dayStart)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0=Вс..6=Сб
  const daysSinceMonday = (weekday + DAYS_FROM_SUNDAY_TO_MONDAY) % DAYS_PER_WEEK
  return new Date(dayStart.getTime() - daysSinceMonday * MS_PER_DAY)
}

/** `date` + `days` календарных суток — безопасно при фиксированном офсете (без DST), см. JSDoc файла. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

/** Компактная дата Asia/Dushanbe (`YYMMDD`) — 1:1 формат `toDushanbeYYMMDD` (см. JSDoc файла), для ключа идемпотентности. */
export function toDushanbeYYMMDD(date: Date): string {
  const { year, month, day } = dushanbeDateParts(date)
  const twoDigitYear = String(year % 100).padStart(2, '0')
  const twoDigitMonth = String(month).padStart(2, '0')
  const twoDigitDay = String(day).padStart(2, '0')
  return `${twoDigitYear}${twoDigitMonth}${twoDigitDay}`
}

/**
 * Ключ идемпотентности повторного прогона за ТУ ЖЕ дату (AC2 тикета, «Что сделать» п.2,
 * вариант 1 — `processed_events`-подобная защита ключом `(consumer, event_id=hash(chainId+
 * date))`, выбран как более простой из двух предложенных тикетом: переиспользует УЖЕ
 * существующую таблицу `processed_events` (EP-01, DTJ-016) через raw SQL из apps/worker,
 * альтернатива — `inventory_sync_batches`-подобный НОВЫЙ журнал — требовала бы ещё одной
 * миграции сверх уже добавленной `platform_billing_invoices` этим же тикетом).
 *
 * `processed_events.event_id` — колонка `uuid`. SHA-256(parts) даёт детерминированный хеш;
 * первые 32 hex-символа форматируются в canonical UUID-паттерн (8-4-4-4-12) — НЕ настоящий
 * UUIDv5 (version/variant biты не выставлены), Postgres `uuid`-тип это не проверяет, значение
 * никогда не показывается пользователю — синтетический идентификатор, не публичный ID.
 */
export function deterministicEventId(...parts: readonly string[]): string {
  const hex = createHash('sha256').update(parts.join(':')).digest('hex').slice(0, HEX_CHARS_FOR_UUID)
  return `${hex.slice(0, UUID_GROUP_1_END)}-${hex.slice(UUID_GROUP_1_END, UUID_GROUP_2_END)}-${hex.slice(UUID_GROUP_2_END, UUID_GROUP_3_END)}-${hex.slice(UUID_GROUP_3_END, UUID_GROUP_4_END)}-${hex.slice(UUID_GROUP_4_END, HEX_CHARS_FOR_UUID)}`
}
