/**
 * Публичный фасад модуля `orders` (EP-09, DTJ-220, наполнен DTJ-222).
 *
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2: единственный легальный путь межмодульного
 * взаимодействия для чужих bounded contexts (EP-10..EP-14 читают заказы ТОЛЬКО отсюда).
 * Импорт `modules/orders/domain|application|infrastructure|presentation` напрямую —
 * блокирующее нарушение (`dependency-cruiser`, `no-cross-module-deep-import`).
 *
 * `OrdersFacade` (класс+методы) реализован в `application/orders.facade.ts` (DTJ-222,
 * `files_owned`) — здесь только ре-экспорт типа + DI-токен, тот же приём, что
 * `modules/catalog/index.ts` (`CATALOG_FACADE`).
 */
export type { OrdersFacade, DeliverySnapshot } from './application/orders.facade.js'

/** DI-токен для провайдера `OrdersFacade` (`{ provide: ORDERS_FACADE, useClass: OrdersFacade }`, DTJ-222). */
export const ORDERS_FACADE = Symbol.for('@dorutj/orders/orders-facade')

/**
 * `PaymentInvoicePort` (DTJ-220, реализуется `payments`-модулем — DTJ-241, `PaymentInvoiceAdapter`).
 * Ре-экспорт токена + типов через фасад (`02` §1.2) — без этого `payments/infrastructure/
 * adapters/payment-invoice.adapter.ts` был бы вынужден импортировать `orders/application/
 * ports/payment-invoice.port.ts` напрямую (`no-cross-module-deep-import`, depcruise).
 * Контракт зафиксирован потребителем (`CheckoutUseCase`) и не меняется этим ре-экспортом
 * (решение D-EP09-17, `reports/EP09-CTO-BRIEF.md`).
 */
export {
  PAYMENT_INVOICE_PORT,
  type PaymentInvoicePort,
  type CreateInvoiceCommand as PaymentInvoiceCreateCommand,
  type InvoiceRef as PaymentInvoiceRef,
  type PaymentInvoiceError,
} from './application/ports/payment-invoice.port.js'

/**
 * `RefundFacadePort` (DTJ-232, EP-09; реализуется `payments`-модулем — DTJ-245,
 * `RefundFacadeAdapter`). Ре-экспорт токена + типов через фасад (`02` §1.2) — тот же приём,
 * что `PAYMENT_INVOICE_PORT` выше: без этого `payments/infrastructure/adapters/
 * refund-facade.adapter.ts` был бы вынужден импортировать `orders/application/ports/
 * refund-facade.port.ts`/`orders/domain/order-domain-event.ts` напрямую
 * (`no-cross-module-deep-import`, depcruise).
 */
export {
  REFUND_FACADE_PORT,
  type RefundFacadePort,
  type RefundError,
  type PartialFulfillmentRefundCommand,
} from './application/ports/refund-facade.port.js'
export { type OrderCancelReason } from './domain/order-domain-event.js'
