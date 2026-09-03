/**
 * Порт `BankWebhookVerifierRegistryPort` (EP-10, DTJ-242, SRS-PAY-019, `21-module-orders-
 * payments-escrow.md` §5.2 п.1) — «карта provider → verifier», по которой
 * `HandlePaymentWebhookUseCase` резолвит `BankWebhookVerifierPort` по заголовку
 * `X-Payment-Provider` (ticket «Что сделать» п.2.1).
 *
 * ОТЛИЧИЕ от `BANK_WEBHOOK_VERIFIER_PORT` (`bank-webhook-verifier.port.ts`, DTJ-237/239):
 * тот токен резолвит РОВНО ОДИН, ГЛОБАЛЬНО активный верификатор — выбранный
 * `AppConfigService.paymentDriver` (SRS-PAY-009, один `PAYMENT_DRIVER` на инсталляцию,
 * используется `CreatePaymentInvoiceUseCase`/`PaymentInvoiceAdapter` для ИСХОДЯЩИХ вызовов
 * провайдера). ВХОДЯЩИЙ вебхук — другая ось: банк САМ называет себя в заголовке, входящий
 * трафик не обязан совпадать с текущим активным `PAYMENT_DRIVER` (R1: `mock_bank` — активный
 * исходящий провайдер, но верификаторы `alif_mobi`/`dc_next` уже существуют и МОГУТ
 * обрабатывать чужой входящий вебхук — заготовка R3, SRS-PAY-006). Отсюда — ОТДЕЛЬНЫЙ порт,
 * не переиспользование `BANK_WEBHOOK_VERIFIER_PORT`.
 *
 * Реализация (`payments.module.ts`) — тонкая обёртка НАД уже существующим
 * `BankWebhookVerifierRegistry` (приватный DI-aggregator того же файла, заведённый DTJ-239
 * для `useFactory` активного провайдера) — не второй набор `@Inject()`, тот же граф синглтонов.
 */
import type { BankWebhookVerifierPort } from './bank-webhook-verifier.port.js'

export const BANK_WEBHOOK_VERIFIER_REGISTRY = Symbol.for('@dorutj/payments/bank-webhook-verifier-registry')

export interface BankWebhookVerifierRegistryPort {
  /** `null` — `providerName` не зарегистрирован НИ ОДНИМ адаптером (SRS-PAY-019: `400 WEBHOOK_PROVIDER_UNKNOWN`). */
  resolve(providerName: string): BankWebhookVerifierPort | null
}
