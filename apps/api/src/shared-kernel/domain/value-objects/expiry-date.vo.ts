/**
 * `ExpiryDate` Value Object (EP-01, DTJ-011, SRS-DOM-087/088) — жёсткая
 * блокировка продажи просроченного товара.
 *
 * Формат `"YYYY-MM-DD"`, без времени, сравнение ЛЕКСИКОГРАФИЧЕСКОЕ
 * (ISO-8601 сортируется лексикографически = хронологически, SRS-API-008).
 *
 * Два независимых правила:
 *   - `isSellable(today)` — буфер 0, НЕ конфигурируется (SRS-DOM-087).
 *     `date <= today` → `false` (включительно: в день истечения товар УЖЕ просрочен).
 *   - `hasMinimumRemainingShelfLife(today, minDays)` — мягкое правило
 *     для `restock()` (SRS-DOM-088). `minDays` — параметр из
 *     `tenant_settings.RETURN_RESTOCK_MIN_REMAINING_DAYS`, НЕ хардкод.
 */
import { err, ok, type Result } from '@dorutj/domain-kernel'
import { ErrorCode, ValidationError } from '@dorutj/contracts'

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/

export class ExpiryDate {
  private constructor(readonly isoDate: string) {}

  static parse(raw: string): Result<ExpiryDate, ValidationError> {
    if (typeof raw !== 'string' || !ISO_DATE_REGEX.test(raw)) {
      return err(
        new ValidationError(
          `Invalid expiry date format: "${raw}" (expected YYYY-MM-DD)`,
          { raw, expectedFormat: 'YYYY-MM-DD' },
          ErrorCode.VALIDATION_ERROR,
        ),
      )
    }
    return ok(new ExpiryDate(raw))
  }

  /**
   * Жёсткая блокировка продажи (SRS-DOM-087). `date <= today` → `false`.
   * Буфер 0, не конфигурируется.
   */
  isSellable(today: ExpiryDate | Date): boolean {
    const todayStr = today instanceof ExpiryDate ? today.isoDate : toISODate(today)
    return this.isoDate > todayStr
  }

  /**
   * Мягкое правило для `restock()` (SRS-DOM-088). `minDays` задаётся per-tenant.
   * Товар с запасом < minDays → `false` (не возвращается на полку).
   */
  hasMinimumRemainingShelfLife(today: ExpiryDate | Date, minDays: number): boolean {
    if (!Number.isInteger(minDays) || minDays < 0) {
      throw new Error(`minDays must be non-negative integer: ${String(minDays)}`)
    }
    const todayDayNumber = today instanceof ExpiryDate ? isoDateToDayNumber(today.isoDate) : dateToDayNumber(today)
    const expiryDayNumber = isoDateToDayNumber(this.isoDate)
    const diffDays = expiryDayNumber - todayDayNumber
    return diffDays >= minDays
  }
}

function isoDateToDayNumber(iso: string): number {
  // `iso` уже провалидирован `ISO_DATE_REGEX` в `ExpiryDate.parse`; повторное
  // сопоставление здесь достаёт год/месяц/день без магических индексов среза.
  const match = ISO_DATE_REGEX.exec(iso)
  if (!match) {
    throw new Error(`Invalid expiry date format: "${iso}" (expected YYYY-MM-DD)`)
  }
  const [, yearStr, monthStr, dayStr] = match
  return daysFromCivil(Number(yearStr), Number(monthStr), Number(dayStr))
}

function dateToDayNumber(d: Date): number {
  // `today: Date` от внешнего вызывающего кода — нормализуем к номеру дня
  // (UTC), чтобы разница в «целых днях» не зависела от времени суток и
  // часового пояса вызывающего.
  return daysFromCivil(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

const YEARS_PER_ERA = 400
const DAYS_PER_ERA = 146_097 // 400 григорианских лет = 146097 дней
const DAYS_PER_YEAR = 365
const LEAP_YEAR_INTERVAL = 4
const CENTURY_YEARS = 100
const EPOCH_OFFSET_DAYS = 719_468 // сдвиг от 0000-03-01 (начало эры) до 1970-01-01
const MONTHS_BEFORE_MARCH = 3 // март (в этом алгоритме год начинается с марта)
const MONTHS_AFTER_MARCH_OFFSET = 9 // month + 9, чтобы март..декабрь стали 0..9
const DAY_OF_YEAR_MULTIPLIER = 153
const DAY_OF_YEAR_DIVISOR = 5

/**
 * Номер дня от эпохи 1970-01-01 для проленптического григорианского
 * календаря — алгоритм `days_from_civil` (Howard Hinnant). Чистая
 * арифметика без обращения к `Date`: домен не читает время напрямую и не
 * конструирует его — только принимает через порт `Clock` (§2.6). Здесь
 * `Date` используется только КАК ВХОДНОЙ параметр (см. `dateToDayNumber`),
 * само значение days-since-epoch вычисляется без него.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year
  const era = Math.floor((shiftedYear >= 0 ? shiftedYear : shiftedYear - (YEARS_PER_ERA - 1)) / YEARS_PER_ERA)
  const yearOfEra = shiftedYear - era * YEARS_PER_ERA // [0, 399]
  const monthIndex = month > 2 ? -MONTHS_BEFORE_MARCH : MONTHS_AFTER_MARCH_OFFSET
  const dayOfYear =
    Math.floor((DAY_OF_YEAR_MULTIPLIER * (month + monthIndex) + 2) / DAY_OF_YEAR_DIVISOR) + day - 1 // [0, 365]
  const dayOfEra =
    yearOfEra * DAYS_PER_YEAR +
    Math.floor(yearOfEra / LEAP_YEAR_INTERVAL) -
    Math.floor(yearOfEra / CENTURY_YEARS) +
    dayOfYear // [0, 146096]
  return era * DAYS_PER_ERA + dayOfEra - EPOCH_OFFSET_DAYS
}

const ISO_YEAR_LENGTH = 4
const ISO_DATE_PART_LENGTH = 2
const ISO_DATE_PAD_CHAR = '0'

function toISODate(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(ISO_YEAR_LENGTH, ISO_DATE_PAD_CHAR)
  const mm = (d.getUTCMonth() + 1).toString().padStart(ISO_DATE_PART_LENGTH, ISO_DATE_PAD_CHAR)
  const dd = d.getUTCDate().toString().padStart(ISO_DATE_PART_LENGTH, ISO_DATE_PAD_CHAR)
  return `${yyyy}-${mm}-${dd}`
}
