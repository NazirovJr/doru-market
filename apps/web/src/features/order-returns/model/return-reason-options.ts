/**
 * `getAvailableReturnReasons` (DTJ-276, EP-11, «Что сделать» п.3) — чистая функция: причины
 * возврата, доступные КЛИЕНТУ в `RequestReturnForm`, в зависимости от статуса заказа.
 *
 * `delivered` → все причины `RETURN_REASON_VALUES` (`@dorutj/contracts/returns.ts`), КРОМЕ
 * `undelivered` — она не создаёт `OrderReturn` вовсе (`RequestReturnUseCase.redirectToSupport`,
 * DTJ-273, SRS-RET-003), обрабатывается отдельной кнопкой «Не получил заказ» (переход в создание
 * `support_tickets`, вне периметра этого тикета).
 *
 * Любой другой статус, включая `picked_up` — пустой список. `picked_up` формально допускает
 * `refused_at_door`/`undeliverable` (`order-return.state-machine.ts`, ветка до вручения), но эта
 * ветка инициируется курьером/диспетчером (`RequestReturnUseCase.requestCourierBranch`), не
 * клиентом — клиентский UI её не показывает вовсе (тикет, буквально).
 */
import { RETURN_REASON_VALUES, type OrderStatus, type ReturnReason } from '@dorutj/contracts'

const CUSTOMER_HIDDEN_REASON: ReturnReason = 'undelivered'

export function getAvailableReturnReasons(orderStatus: OrderStatus): readonly ReturnReason[] {
  if (orderStatus === 'delivered') {
    return RETURN_REASON_VALUES.filter((reason) => reason !== CUSTOMER_HIDDEN_REASON)
  }
  return []
}
