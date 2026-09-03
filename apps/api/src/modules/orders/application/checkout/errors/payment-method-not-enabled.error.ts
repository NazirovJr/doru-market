/**
 * `PaymentMethodNotEnabledError` (EP-09, DTJ-229, SRS-ORD-025 п.2) — `paymentMethod`,
 * переданный клиентом, не входит в `tenantSettings.enabledPaymentMethods`.
 *
 * Канонический код `PAYMENT_METHOD_NOT_ENABLED` (422, `packages/contracts/src/errors.ts`) —
 * тот же приём, что `onboarding/domain/errors/already-reviewed.error.ts`: класс объявлен
 * ЛОКАЛЬНО в модуле (не дублирует `BusinessRuleViolationError` в `packages/contracts`), код
 * зарегистрирован централизованно (правило 15 AGENTS.md — единственный экземпляр реестра
 * кодов), сам класс — module-local удобство конструктора.
 */
import { BusinessRuleViolationError, ErrorCode } from '@dorutj/contracts'

export class PaymentMethodNotEnabledError extends BusinessRuleViolationError {
  constructor(details?: Record<string, unknown>) {
    super('Payment method is not enabled for this tenant', details, ErrorCode.PAYMENT_METHOD_NOT_ENABLED)
  }
}
