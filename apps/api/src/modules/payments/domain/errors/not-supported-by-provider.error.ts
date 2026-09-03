/**
 * `NotSupportedByProviderError` (EP-10, DTJ-237, SRS-PAY-001/§3.1) — операция, которую вызвали
 * на `PaymentProvider`, чьи `capabilities()` явно её не поддерживают (напр. `partialRefund()`
 * при `supportsPartialRefund === false`). Симметрично для `capturePreauth`/`voidPreauth` при
 * `!supportsHoldCapture` (D-02: hold/capture — банковский механизм, не программный ledger).
 *
 * ВАЖНО (JSDoc `payment-provider.port.ts`): бросок этой ошибки документирует КОНТРАКТ метода,
 * не реализует рантайм-проверку — каждый адаптер (`MockBankProvider`, DTJ-238) обязан САМ
 * сверяться со своими `capabilities()` перед выполнением операции и возвращать
 * `Err(new NotSupportedByProviderError(...))`, а не полагаться на внешнюю проверку.
 */
import { PaymentProviderError } from './payment-provider.error.js'

const NOT_SUPPORTED_BY_PROVIDER_CODE = 'NOT_SUPPORTED_BY_PROVIDER'

export class NotSupportedByProviderError extends PaymentProviderError {
  public constructor(operation: string, providerName: string) {
    super(NOT_SUPPORTED_BY_PROVIDER_CODE, `Operation "${operation}" is not supported by provider "${providerName}"`, {
      operation,
      providerName,
    })
  }
}
