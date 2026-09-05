/**
 * Порт `OnboardingFacadePort` — СВОЯ копия `payments`-модуля (DTJ-252, REQ-MON-9), НЕ импорт
 * чужого `orders/application/ports/onboarding-facade.port.ts` (`02-CLEAN-ARCHITECTURE-AND-CODE.md`
 * §1.2 — межмодульный импорт из `application`/`domain` чужого модуля запрещён, каждый
 * модуль-потребитель заводит СВОЙ узкий порт под свою реальную потребность, тот же приём, что
 * `orders`/`payments` уже делают для других межмодульных фасадов). Единственный метод, который
 * нужен ЭТОМУ модулю — НЕ повторяет весь интерфейс сестринского порта (`isPharmacyActive`/
 * `getPharmacyNames` там `payments` не нужны).
 *
 * `reason` НЕ параметр метода (в отличие от предложения ревью координатора) — единственный
 * реальный вызывающий (`BillingInvoiceOverdueJob` через HTTP-мост) ВСЕГДА приостанавливает по
 * ОДНОЙ причине (неоплаченный инвойс, имя метода уже это фиксирует), доменный метод-получатель
 * (`OnboardingFacade.suspendChainForUnpaidInvoice`) сам жёстко передаёт `'unpaid_invoice'` в
 * `PharmacyChain.suspend()` — второй параметр здесь добавлял бы гибкость без реального второго
 * потребителя (YAGNI, тот же довод, что `verifyHmacSha256Signature`/`PaymentsInternalServiceGuard`
 * про «не абстракция на будущее», только в обратную сторону — здесь МЕНЬШЕ параметров, не больше).
 */
export const ONBOARDING_FACADE_PORT = Symbol.for('@dorutj/payments/onboarding-facade')

export interface OnboardingFacadePort {
  /**
   * `pharmacy_chains.status: active → suspended` за неоплаченный B2B-инвойс. Идемпотентно (см.
   * `OnboardingFacade.suspendChainForUnpaidInvoice` JSDoc, `apps/api/src/modules/onboarding/
   * onboarding.facade.ts`) — повторный вызов на уже `suspended` сети — no-op, не ошибка.
   */
  suspendChain(chainId: string): Promise<void>
}
