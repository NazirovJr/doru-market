/**
 * `PriceOrStockChangedError` (EP-09, DTJ-231, SRS-ORD-023) — цена/остаток изменились между тем,
 * что клиент видел (`GET /api/v1/cart`), и фактическим `POST /api/v1/orders`. Брошена
 * `DetectPriceDriftService.check()` (тот же файл `checkout/`) ВНУТРИ транзакции ОДНОЙ группы
 * (`CheckoutUseCase.processGroup`) — откатывает эту транзакцию целиком (реверсирует резерв
 * остатка), не весь checkout: `catch (error instanceof DomainError)` в `processGroup` ловит её
 * так же, как `InsufficientStockError`/любую другую доменную ошибку группы, кладёт в
 * `failedGroups` этой аптеки (SRS-ORD-019).
 *
 * Канонический код `PRICE_OR_STOCK_CHANGED` (409, `packages/contracts/src/errors.ts`) — тот же
 * приём, что `PaymentMethodNotEnabledError` (`../errors/payment-method-not-enabled.error.ts`):
 * класс объявлен ЛОКАЛЬНО в модуле, код зарегистрирован централизованно (правило 15 AGENTS.md).
 *
 * `ConflictError`, не `BusinessRuleViolationError` — источник (тикет DTJ-231 «Что сделать» п.1)
 * называет `409`, не `422`: это конфликт версии состояния (цена/остаток успели измениться), не
 * нарушение бизнес-правила заказа.
 */
import { ConflictError, ErrorCode } from '@dorutj/contracts'

export class PriceOrStockChangedError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Price or stock changed since the client last saw it', details, ErrorCode.PRICE_OR_STOCK_CHANGED)
  }
}
