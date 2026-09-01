/**
 * `OrderNumber` Value Object (EP-01, DTJ-011, SRS-DOM-085/086) — человекочитаемый
 * идентификатор заказа формата `DTJ-{YYMMDD}-{seq5}`, ровно 16 символов.
 *
 * **Неизменяем после присвоения** (SRS-DOM-086) — НЕТ `regenerate()`-метода.
 * `seq5` — атомарный дневной счётчик через Redis `INCR order_seq:{YYMMDD}` с
 * `EXPIRE` на 48 часов (см. `OrderNumberGeneratorPort`, тикет DTJ-011).
 */
import { err, ok, type Result } from '@dorutj/domain-kernel'
import { ErrorCode, ValidationError } from '@dorutj/contracts'
import { OrderNumberSequenceExhaustedError } from '@/shared-kernel/domain/errors/order-number-sequence-exhausted.error.js'

const FORMAT_REGEX = /^DTJ-\d{6}-\d{5}$/
const SEQ5_MIN = 1
const SEQ5_MAX = 99_999
const SEQ5_PADDING = 5

export class OrderNumber {
  private constructor(readonly value: string) {}

  /** Создаёт `OrderNumber` из календарной даты (`YYMMDD`) и `seq5`. */
  static fromParts(dateYYMMDD: string, seq5: number): OrderNumber {
    if (seq5 < SEQ5_MIN || seq5 > SEQ5_MAX || !Number.isInteger(seq5)) {
      throw new OrderNumberSequenceExhaustedError({ seq5, dateYYMMDD, min: SEQ5_MIN, max: SEQ5_MAX })
    }
    return new OrderNumber(`DTJ-${dateYYMMDD}-${String(seq5).padStart(SEQ5_PADDING, '0')}`)
  }

  /** Парсит строку из БД / audit log. */
  static parse(raw: string): Result<OrderNumber, ValidationError> {
    if (typeof raw !== 'string' || !FORMAT_REGEX.test(raw)) {
      return err(
        new ValidationError(
          `Invalid order number format: "${raw}" (expected DTJ-YYMMDD-NNNNN, 16 chars)`,
          { raw, expectedFormat: 'DTJ-{YYMMDD}-{seq5}' },
          ErrorCode.VALIDATION_ERROR,
        ),
      )
    }
    return ok(new OrderNumber(raw))
  }
}
