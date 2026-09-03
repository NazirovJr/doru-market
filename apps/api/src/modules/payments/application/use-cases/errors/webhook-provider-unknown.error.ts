/**
 * `WebhookProviderUnknownError` (EP-10, DTJ-242, SRS-PAY-019) — `X-Payment-Provider` не
 * зарегистрирован ни одним `BankWebhookVerifierPort`-адаптером.
 *
 * Канонический код `WEBHOOK_PROVIDER_UNKNOWN` (400, `packages/contracts/src/errors.ts`) — тот
 * же приём, что `orders/application/order-lifecycle/errors/order-not-retryable.error.ts`
 * (DTJ-241): класс объявлен ЛОКАЛЬНО (`application/use-cases/errors/`, брошен
 * `HandlePaymentWebhookUseCase` ДО обращения к любому порту — `02` §3.2 позволяет use case
 * бросать доменные ошибки напрямую), код зарегистрирован централизованно (правило 15
 * AGENTS.md). `application/**` разрешено импортировать `@dorutj/contracts` — это НЕ
 * `infrastructure`/`presentation` (запрет dependency-cruiser `application-does-not-know-
 * infrastructure` их не покрывает), тот же приём, что `OrderNotRetryableError`.
 */
import { ValidationError, ErrorCode } from '@dorutj/contracts'

export class WebhookProviderUnknownError extends ValidationError {
  constructor(providerName: string) {
    super(`Unknown payment webhook provider: "${providerName}"`, { providerName }, ErrorCode.WEBHOOK_PROVIDER_UNKNOWN)
  }
}
