/**
 * Порт `PaymentInvoicePort` (EP-09, DTJ-220, SRS-ORD-018 шаг 4h, SRS-PAY-001).
 *
 * Межмодульный фасад `orders → payments` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2) —
 * контракт с модулем, которого ЕЩЁ НЕТ физически: EP-10 (`payments`) стартует волной 7, на
 * волну позже EP-09 (`tickets/00-EPICS.md` «Волны выполнения»). Порт объявляется здесь
 * умышленно (не как импорт `modules/payments/*`), чтобы `CheckoutUseCase` (DTJ-227)
 * компилировался и тестировался (с мок-реализацией порта) независимо от прогресса EP-10.
 *
 * Вызывается ТОЛЬКО для `paymentMethod ∈ {'alif_mobi','dc_next'}` (D-25: `cash_courier`
 * никогда не создаёт инвойс — заказ синхронно `confirmed`), ПОСЛЕ commit транзакции создания
 * заказа (SRS-ORD-025) — сетевой таймаут провайдера не должен откатывать уже созданный заказ.
 *
 * Форма `CreateInvoiceCommand`/`InvoiceRef` синхронизирована с `PaymentProvider`-портом,
 * специфицированным `docs/spec/21-module-orders-payments-escrow.md` §3.1 (SRS-PAY-001) —
 * `orders`-сторона использует `string`/`bigint` вместо брендированных типов `payments`-модуля
 * (`OrderId`, `PhoneNumber`), которых `orders` не имеет права импортировать напрямую.
 *
 * Конкретный адаптер и DI-биндинг регистрируются тикетом DTJ-242 (EP-10) — до этого момента
 * порт в `orders.module.ts` НЕ забинжен ни к чему (инжектится только в тестах через мок).
 */
import type { ErrorCode } from '@dorutj/contracts'
import type { Result } from '@dorutj/domain-kernel'

/** DI-токен для провайдера `PaymentInvoicePort`. */
export const PAYMENT_INVOICE_PORT = Symbol.for('@dorutj/orders/payment-invoice')

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

/** Ошибка создания инвойса — коды из общего каталога (`packages/contracts/src/errors.ts`). */
export interface PaymentInvoiceError {
  readonly code:
    | ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE
    | ErrorCode.SERVICE_UNAVAILABLE
    | ErrorCode.VALIDATION_ERROR
  readonly message: string
}

export interface PaymentInvoicePort {
  createInvoice(cmd: CreateInvoiceCommand): Promise<Result<InvoiceRef, PaymentInvoiceError>>
}
