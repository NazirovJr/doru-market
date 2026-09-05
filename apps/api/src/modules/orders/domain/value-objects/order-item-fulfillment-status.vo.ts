/**
 * `OrderItemFulfillmentStatus` — VO терминала фармацевта (DTJ-300, EP-12, модуль 24,
 * SRS-PHT-002/011..020, `[РАСШИРЕНИЕ]`) — прогресс физической сборки ОДНОЙ позиции заказа.
 * НЕ путать с `order.status` (уровень заказа, `apps/api/.../orders/domain/order.state-machine.ts`)
 * — это отдельный, более мелкий прогресс на уровне `order_items.fulfillment_status`.
 *
 * Массив литералов + производный тип + guard-функция — по образцу
 * `apps/api/.../onboarding/domain/value-objects/onboarding-status.vo.ts` (`02` §2.3: VO вместо
 * примитивной строки в сигнатурах use case), НЕ class-wrapper.
 *
 * Граф переходов (`pending → scanned_ok`/`pending → unavailable`, необратимо в пределах терминала
 * — SRS-PHT-013/017) НЕ определяется здесь: это scaffolding-тикет (VO/ошибки/события/схема), сам
 * переход применяют use case'ы `ScanOrderItemUseCase`/`ReportItemIssueUseCase` (DTJ-301+, ещё не
 * начаты) — граф добавляется вместе с ними, чтобы не изобретать машину состояний раньше, чем
 * появится код, который её действительно проверяет (`02` C15).
 */

export const ORDER_ITEM_FULFILLMENT_STATUS_VALUES = ['pending', 'scanned_ok', 'unavailable'] as const

export type OrderItemFulfillmentStatus = (typeof ORDER_ITEM_FULFILLMENT_STATUS_VALUES)[number]

/** Гард для VO-инициализации (парсинга значения enum-колонки БД). */
export function isOrderItemFulfillmentStatus(value: string): value is OrderItemFulfillmentStatus {
  return (ORDER_ITEM_FULFILLMENT_STATUS_VALUES as readonly string[]).includes(value)
}
