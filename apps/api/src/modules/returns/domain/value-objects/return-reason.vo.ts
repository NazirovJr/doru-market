/**
 * `ReturnReason` VO (EP-11, DTJ-271, `10-domain-model.md` §«Value Objects»).
 *
 * Обёртка над enum `return_reason` (`db/schema/enums.schema.ts` `returnReasonEnum`,
 * `11-database-schema.md` строки 138-140). `parse()` возвращает `Result<ReturnReason,
 * ValidationError>` — НЕ бросает исключение на пользовательский ввод (это заведомо ожидаемый
 * сценарий: клиент выбирает причину из списка, невалидное значение — often client-side баг, а
 * не программная ошибка вызывающего кода, отличие от `PhoneNumber.parse()`/`OtpCode.parse()`,
 * которые бросают — тот выбор стиля тикет DTJ-271 явно переопределяет для этого VO).
 *
 * `undelivered` — валидное значение enum'а (схема БД — закон, SRS-DB-008), но `ReturnReason`
 * его ПАРСИТ так же, как любое другое: отклонение `undelivered` в `OrderReturn.request()` —
 * забота фабрики сущности (`UnsupportedReturnReasonError`), не самого VO (SRS-RET-003 — это
 * доменное ПРАВИЛО, не структурная невалидность значения).
 */
import { ok, err, type Result } from '@dorutj/domain-kernel'
import { ValidationError, RETURN_REASON_VALUES, type ReturnReason as ReturnReasonValue } from '@dorutj/contracts'

const RETURN_REASON_VALUES_SET: readonly string[] = RETURN_REASON_VALUES

export class ReturnReason {
  private constructor(readonly value: ReturnReasonValue) {}

  static parse(raw: string): Result<ReturnReason, ValidationError> {
    if (typeof raw !== 'string' || !RETURN_REASON_VALUES_SET.includes(raw)) {
      return err(new ValidationError('Invalid return reason', { field: 'reason', received: raw }))
    }
    return ok(new ReturnReason(raw as ReturnReasonValue))
  }

  /** Конструирует напрямую из уже валидного значения (снэпшот БД/другой VO — доверенный источник). */
  static fromTrusted(value: ReturnReasonValue): ReturnReason {
    return new ReturnReason(value)
  }

  equals(other: ReturnReason): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
