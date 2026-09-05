/**
 * Порт `ReturnsPaymentsPort` (EP-11, DTJ-270, `21-module-orders-payments-escrow.md` §7.2,
 * SRS-RET-004..009).
 *
 * Межмодульный фасад `returns → payments` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2) —
 * ЕДИНСТВЕННЫЙ разрешённый способ, которым `returns` инициирует денежный исход возврата.
 * Прямой импорт `modules/payments/domain/*`/`modules/payments/application/*` из `returns` —
 * блокирующее нарушение (`dependency-cruiser`, `no-cross-module-deep-import`). 1:1 паттерн
 * `modules/payments/application/ports/orders-facade.port.ts` (DTJ-236).
 *
 * Методы 1:1 c `ReturnFinancialOutcome` (DTJ-272, `return-financial-outcome.types.ts`):
 * `itemsRefund`/`deliveryFeeRefund` со значением `'full'` вызывают `refundItems`/
 * `refundDelivery`, `customer_dispute_post_delivery` с полным зачётом — `refundFull`,
 * административная корректировка вне обычного потока — `recordAdjustment`. Точные сигнатуры
 * уточняются DTJ-274 (`21-module-orders-payments-escrow.md` §7.2) — здесь заведомо достаточный
 * набор параметров для компиляции application-слоя этого эпика, реализация — вне периметра
 * DTJ-270 (см. `application/ports/orders-facade.port.ts` этого же модуля, тот же приём).
 *
 * `amountDiram` — `bigint`, никогда `number`/`float` (правило 6 AGENTS.md).
 */
import type { ReturnsUnitOfWorkTx } from './orders-facade.port.js'

/** DI-токен для провайдера `ReturnsPaymentsPort`. */
export const RETURNS_PAYMENTS_PORT = Symbol.for('@dorutj/returns/payments-facade')

export interface ReturnsRefundItemsCommand {
  readonly orderId: string
  readonly returnId: string
  readonly amountDiram: bigint
}

export interface ReturnsRefundDeliveryCommand {
  readonly orderId: string
  readonly returnId: string
  readonly amountDiram: bigint
}

export interface ReturnsRefundFullCommand {
  readonly orderId: string
  readonly returnId: string
  readonly amountDiram: bigint
}

export interface ReturnsRecordAdjustmentCommand {
  readonly orderId: string
  readonly returnId: string
  readonly amountDiram: bigint
  /** Обязателен — зеркалит `AdjustmentRequiresReasonError` (`modules/payments/domain/errors`). */
  readonly reason: string
  readonly actorUserId: string
}

export interface ReturnsPaymentsPort {
  refundItems(tenantId: string, command: ReturnsRefundItemsCommand, tx?: ReturnsUnitOfWorkTx): Promise<void>
  refundDelivery(tenantId: string, command: ReturnsRefundDeliveryCommand, tx?: ReturnsUnitOfWorkTx): Promise<void>
  refundFull(tenantId: string, command: ReturnsRefundFullCommand, tx?: ReturnsUnitOfWorkTx): Promise<void>
  recordAdjustment(tenantId: string, command: ReturnsRecordAdjustmentCommand, tx?: ReturnsUnitOfWorkTx): Promise<void>
}
