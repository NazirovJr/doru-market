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

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

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
    const todayDate = today instanceof ExpiryDate ? parseISODate(today.isoDate) : startOfDay(today)
    const expiry = parseISODate(this.isoDate)
    const diffDays = Math.floor((expiry.getTime() - todayDate.getTime()) / MS_PER_DAY)
    return diffDays >= minDays
  }
}

function parseISODate(iso: string): Date {
  // `new Date('YYYY-MM-DD')` парсит как UTC; мы сравниваем только дни,
  // таймзона не важна.
  return new Date(`${iso}T00:00:00.000Z`)
}

function startOfDay(d: Date): Date {
  // `today: Date` от внешнего вызывающего кода — нормализуем к началу дня
  // (UTC), чтобы сравнение `expiry - today` в «целых днях» не зависело
  // от часового пояса вызывающего.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function toISODate(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0')
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = d.getUTCDate().toString().padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
