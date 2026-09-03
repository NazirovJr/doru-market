/**
 * `ReturnDisposition` VO (EP-11, DTJ-271, `10-domain-model.md` §«Value Objects»).
 *
 * Обёртка над enum `return_disposition` (`db/schema/enums.schema.ts` `returnDispositionEnum`,
 * `11-database-schema.md` строка 142): `restock` / `destroy` / `pending_inspection`.
 *
 * В отличие от `ReturnReason` (парсится из пользовательского выбора), значение этого VO почти
 * всегда ВЫЧИСЛЯЕТСЯ доменом (`OrderReturn.confirmReceived()`), а не парсится из внешнего ввода —
 * `parse()` присутствует для полноты API/симметрии с `ReturnReason` (пригодится presentation-
 * слою DTJ-275, читающему `order_returns.disposition` из БД), но основной путь конструирования —
 * именованные фабрики `restock()`/`destroy()`/`pendingInspection()`.
 */
import { ok, err, type Result } from '@dorutj/domain-kernel'
import { ValidationError, RETURN_DISPOSITION_VALUES, type ReturnDisposition as ReturnDispositionValue } from '@dorutj/contracts'

const RETURN_DISPOSITION_VALUES_SET: readonly string[] = RETURN_DISPOSITION_VALUES

export class ReturnDisposition {
  private constructor(readonly value: ReturnDispositionValue) {}

  static parse(raw: string): Result<ReturnDisposition, ValidationError> {
    if (typeof raw !== 'string' || !RETURN_DISPOSITION_VALUES_SET.includes(raw)) {
      return err(new ValidationError('Invalid return disposition', { field: 'disposition', received: raw }))
    }
    return ok(new ReturnDisposition(raw as ReturnDispositionValue))
  }

  static restock(): ReturnDisposition {
    return new ReturnDisposition('restock')
  }

  static destroy(): ReturnDisposition {
    return new ReturnDisposition('destroy')
  }

  static pendingInspection(): ReturnDisposition {
    return new ReturnDisposition('pending_inspection')
  }

  equals(other: ReturnDisposition): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
