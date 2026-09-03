/**
 * Порт `PaymentProvider` (EP-10, DTJ-237, `21-module-orders-payments-escrow.md` §3.1,
 * SRS-PAY-001..003) — Provider Pattern из устава (Charter §3.3), частный случай портов и
 * адаптеров (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3). ЕДИНСТВЕННАЯ точка, через которую
 * ЛЮБОЙ код платформы разговаривает с банком (реальным или моком) — use case'ы (`Create
 * PaymentInvoiceUseCase`/`HandlePaymentWebhookUseCase`/`RefundOrderUseCase`, DTJ-243+) зависят
 * ТОЛЬКО от этого интерфейса, никогда от конкретного адаптера.
 *
 * `orderId`/`customerPhone` — типизированы `string`, НЕ branded VO (`OrderId`/`PhoneNumber` из
 * иллюстративного псевдокода спеки §3.1): такие типы физически не существуют как
 * межмодульно-импортируемые — `OrderId` нигде в кодовой базе не объявлен, `PhoneNumber`
 * (`modules/auth/domain/value-objects/phone-number.vo.ts`) приватен модулю `auth`. Тот же выбор
 * уже сделан `modules/orders/application/ports/payment-invoice.port.ts` (DTJ-220, EP-09) для
 * идентичного по смыслу `CreateInvoiceCommand` — здесь сохранена симметрия, не изобретён новый
 * прецедент. `amountDiram`/`*Diram` — ВСЕГДА `bigint` (правило 6 задания, SRS-PAY-001).
 *
 * DI-биндинг конкретного адаптера — `payments.module.ts`, ветка по `PAYMENT_DRIVER`
 * (SRS-PAY-009), начиная с DTJ-238 (`MockBankProvider`). Здесь — только объявление токена.
 */
import type { Result } from '@dorutj/domain-kernel'
import type { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'

/** DI-токен для провайдера `PaymentProvider` (`{ provide: PAYMENT_PROVIDER_TOKEN, useClass: ... }`). */
export const PAYMENT_PROVIDER_TOKEN = Symbol.for('@dorutj/payments/payment-provider')

export interface PaymentProviderCapabilities {
  readonly providerName: 'alif_mobi' | 'dc_next' | 'mock_bank'
  /** D-02: банковский hold/capture, а не программный ledger. */
  readonly supportsHoldCapture: boolean
  /** D-10: если `false` — раздельный биллинг items/delivery (`orders.billing_strategy`). */
  readonly supportsPartialRefund: boolean
  /** Окно, в течение которого QR/deeplink валиден (минуты). */
  readonly maxInvoiceValidityMinutes: number
}

export interface CreateInvoiceCommand {
  readonly orderId: string
  readonly amountDiram: bigint
  readonly currency: 'TJS'
  /** = `checkout_attempt_id`-производная (SRS-DOM-166, SRS-PAY-003). */
  readonly idempotencyKey: string
  readonly description: string
  readonly customerPhone: string
}

/** Ссылка на счёт, выставленный банком (SRS-PAY-001). */
export interface InvoiceRef {
  readonly providerRef: string
  /** Содержимое QR / deeplink URI (REQ-UX-16: QR — первый способ оплаты). */
  readonly qrPayload: string
  readonly expiresAt: Date
}

export interface PaymentStatusSnapshot {
  readonly providerRef: string
  readonly status: 'pending' | 'paid' | 'failed' | 'expired'
  readonly amountDiram: bigint
  readonly paidAt: Date | null
}

export interface RefundRef {
  readonly providerRefundRef: string
  readonly amountDiram: bigint
  readonly status: 'pending' | 'succeeded' | 'failed'
}

/**
 * Результат `capturePreauth()` (ASSUMPTION этого тикета — спека §3.1 использует тип в сигнатуре
 * опционального метода, но не определяет его форму: hold/capture недостижим ни у одного
 * реального R1-адаптера, `MockBankProvider.capabilities().supportsHoldCapture === false`,
 * DTJ-238 п.1). Форма — по аналогии с `RefundRef`, уточняется адаптером R3, который реально
 * реализует `capturePreauth`.
 */
export interface CaptureRef {
  readonly providerCaptureRef: string
  readonly amountDiram: bigint
  readonly status: 'pending' | 'succeeded' | 'failed'
}

export interface PaymentProvider {
  /** Синхронный: значения известны на этапе конфигурации DI, не требуют сетевого вызова. */
  capabilities(): PaymentProviderCapabilities

  createInvoice(cmd: CreateInvoiceCommand): Promise<Result<InvoiceRef, PaymentProviderError>>

  /**
   * ИСКЛЮЧИТЕЛЬНО для реконсиляции/диагностики (SRS-PAY-002, §5.7/§4.3). КАТЕГОРИЧЕСКИ
   * ЗАПРЕЩЕНО использовать результат этого метода для смены `order.status` — единственный
   * легальный путь перевода заказа в `paid_escrow` остаётся подписанный вебхук
   * (`HandlePaymentWebhookUseCase`, SRS-PAY-018/§5.1, категорический запрет с ОДНИМ
   * исключением — `AdminPaymentOverrideUseCase`). Опрос этого метода в цикле как замена
   * вебхука — архитектурное нарушение, блокирующее замечание код-ревью, а не деталь
   * реализации на усмотрение исполнителя.
   */
  getStatus(providerRef: string): Promise<Result<PaymentStatusSnapshot, PaymentProviderError>>

  /**
   * `idempotencyKey` ПРИНИМАЕТСЯ явно (REQ-PAY-8, SRS-PAY-003) — адаптер обязан проверить
   * локальную идемпотентность (`payment_operations` UNIQUE) ПЕРЕД сетевым вызовом провайдера,
   * не полагаться исключительно на нативную идемпотентность банка (её может не быть).
   */
  refund(providerRef: string, idempotencyKey: string): Promise<Result<RefundRef, PaymentProviderError>>

  /**
   * Бросает (возвращает `Err`) `NotSupportedByProviderError`, если
   * `!capabilities().supportsPartialRefund` — задокументированное поведение контракта, НЕ
   * реализуется этим тикетом как рантайм-логика (чистый интерфейс, DTJ-237); каждый адаптер
   * обязан сам соблюдать это поведение (см. JSDoc `NotSupportedByProviderError`).
   */
  partialRefund(
    providerRef: string,
    amountDiram: bigint,
    idempotencyKey: string,
  ): Promise<Result<RefundRef, PaymentProviderError>>

  /** Опционален (REQ-PAY-10) — эскроу НЕ зависит от наличия, вызывается только если `supportsHoldCapture`. */
  capturePreauth?(providerRef: string, amountDiram: bigint): Promise<Result<CaptureRef, PaymentProviderError>>

  /** Опционален (REQ-PAY-10), см. `capturePreauth`. */
  voidPreauth?(providerRef: string): Promise<Result<void, PaymentProviderError>>
}
