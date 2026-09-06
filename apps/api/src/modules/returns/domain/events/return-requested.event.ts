/**
 * `ReturnRequestedEvent` (EP-11, DTJ-273, SRS-RET-001/002, SRS-DOM-151). Публикуется через
 * `outbox` в ТОЙ ЖЕ транзакции, что `INSERT order_returns` — по обеим ветвям `RequestReturnUseCase`
 * (курьерская `return_in_transit` и пост-доставочная `return_requested`), `status` различает их.
 */
import type { ReturnReason, ReturnStatus } from '@dorutj/contracts'

export interface ReturnRequestedEvent {
  readonly type: 'ReturnRequestedEvent'
  readonly returnId: string
  readonly orderId: string
  readonly reason: ReturnReason
  readonly initiatedBy: string
  readonly status: ReturnStatus
}
