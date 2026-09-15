/**
 * `UnimplementedReturnsPaymentsAdapter` (EP-11, DTJ-274) — NullAdapter, правило 15 AGENTS.md,
 * `TODO(EP-10)`. 1:1 приём, что `UnimplementedReturnsDeliveryAdapter` этого же каталога (DTJ-273).
 *
 * **Найдено при подготовке этого тикета (foundIssue, не домысел тикета):** `PaymentsFacade`
 * (`modules/payments/index.ts`, DTJ-249) на момент этого тикета экспортирует ТОЛЬКО
 * `holdPayout` — ни `refundItems`/`refundDelivery`/`refundFull`, ни `recordAdjustment` не
 * являются частью публичного фасада `payments` (хотя `RefundOrderUseCase`/
 * `late-payment-refund.service.ts` физически существуют ВНУТРИ модуля `payments` — правило
 * владения файлов `returns` запрещает `returns` импортировать их напрямую, а расширение ЧУЖОГО
 * публичного фасада — решение владельца EP-10, не одностороннее действие этого тикета).
 * Ticket DTJ-274 «Риски» прямо предвидел этот случай: «если фасад EP-10 ещё не готов —
 * реализовать порт против мок-адаптера и зафиксировать несоответствие в PR как блокер для
 * мержа, не для написания кода» — этот класс и есть такой мок-адаптер уровня DI (тест-план
 * тикета использует СВОЙ, отдельный мок `ReturnsPaymentsPort` в спеках, не этот класс).
 *
 * Существует ТОЛЬКО чтобы `RETURNS_PAYMENTS_PORT` резолвился Nest'ом (иначе
 * `RefundOnReturnResolvedUseCase` не собирается) — бросает, не «правдоподобный noop»: молчаливый
 * отказ от рефанда — денежная ошибка (правило 6 AGENTS.md), координатору нужен явный сигнал при
 * первом реальном вызове в проде, а не тихо потерянные деньги клиента.
 *
 * TODO(EP-10): заменить на реальный адаптер, оборачивающий расширенный `PaymentsFacade`
 * (`refundItems`/`refundDelivery`/`refundFull`/`recordAdjustment`), когда владелец EP-10 добавит
 * эти методы в свой публичный фасад — ЭТО БЛОКЕР ДЛЯ МЕРЖА В PRODUCTION, не для написания кода
 * данного тикета (см. JSDoc выше).
 */
import type {
  ReturnsPaymentsPort,
  ReturnsRefundItemsCommand,
  ReturnsRefundDeliveryCommand,
  ReturnsRefundFullCommand,
  ReturnsRecordAdjustmentCommand,
} from '@/modules/returns/application/ports/payments-facade.port.js'

const NOT_IMPLEMENTED_MESSAGE =
  'ReturnsPaymentsPort has no real implementation yet — TODO(EP-10): extend PaymentsFacade with refund/adjustment methods and bind a real adapter.'

export class UnimplementedReturnsPaymentsAdapter implements ReturnsPaymentsPort {
  refundItems(_tenantId: string, _command: ReturnsRefundItemsCommand): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE))
  }

  refundDelivery(_tenantId: string, _command: ReturnsRefundDeliveryCommand): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE))
  }

  refundFull(_tenantId: string, _command: ReturnsRefundFullCommand): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE))
  }

  recordAdjustment(_tenantId: string, _command: ReturnsRecordAdjustmentCommand): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE))
  }
}
