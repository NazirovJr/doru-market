/**
 * Порт `RefundFacadePort` (EP-09, DTJ-232, SRS-DOM-092/093, SRS-ORD-029).
 *
 * Межмодульный фасад `orders → payments` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2) —
 * контракт к EP-11 (`tickets/ep07-returns-disputes`), который заморожен решением CTO до
 * волны 8 (`reports/CTO-DECISION-WAVE5.md` §1). Тот же приём отложенного DI-биндинга, что
 * `PaymentInvoicePort` (`payment-invoice.port.ts`, DTJ-220/227/242) — порт объявляется здесь,
 * чтобы `CancelOrderUseCase` компилировался и тестировался (мок-реализацией) независимо от
 * того, когда EP-11 будет нарезан на тикеты. Владелец маркера — `TODO(EP-11)`, не выдуманный
 * `DTJ-*` (эпик документирован, но не нарезан — тот же приём, утверждённый CTO для
 * `TODO(R2-4)`, `reports/EP09-CTO-BRIEF.md` D-EP09-8/28).
 *
 * Вызывается ТОЛЬКО когда заказ реально был в `paid_escrow`/`processing` (non-cash) на момент
 * отмены (D-25) — `CancelOrderUseCase` — единственная точка этого решения (не дублируется).
 * Для `cash_courier` этот порт НЕ вызывается вовсе: наличные никогда не собирались курьером,
 * `escrow_ledger` для такого заказа пуст на всём жизненном цикле (D-EP09-29,
 * `21-module-orders-payments-escrow.md:1189-1194`).
 *
 * D-EP09-16/28 (решение CTO): возврат денег — ЗАПИСЬ, у null-адаптера нет безопасного дефолта
 * (молчаливый успех без реального возврата — тихая потеря денег клиента) — заглушка ОБЯЗАНА
 * бросать, не «успешно» возвращать ноль сомони. См. `UnimplementedRefundFacadeAdapter`
 * (`orders.module.ts`, TODO(EP-11)).
 */
import type { ErrorCode } from '@dorutj/contracts'
import type { Result } from '@dorutj/domain-kernel'
import type { OrderCancelReason } from '@/modules/orders/domain/order-domain-event.js'

/** DI-токен для провайдера `RefundFacadePort`. */
export const REFUND_FACADE_PORT = Symbol.for('@dorutj/orders/refund-facade')

/** Ошибка возврата — только коды, уже заведённые в общем каталоге (`packages/contracts/src/errors.ts`),
 * тот же набор, что `PaymentInvoiceError` (симметричная операция — обе говорят с банковским провайдером). */
export interface RefundError {
  readonly code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE | ErrorCode.SERVICE_UNAVAILABLE
  readonly message: string
}

export interface RefundFacadePort {
  /** Полный возврат суммы заказа (SRS-ORD-029: `paid_escrow`/`processing`-non-cash → 100% возврат,
   * частичного возврата в этом контракте нет — он принадлежит EP-11 `OrderDispute`/`OrderReturn`). */
  refundFull(orderId: string, reason: OrderCancelReason): Promise<Result<void, RefundError>>
}
