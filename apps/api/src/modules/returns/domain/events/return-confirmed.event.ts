/**
 * `ReturnConfirmedEvent` (EP-11, DTJ-273, SRS-RET-010). Публикуется и обычным `confirmReceived`
 * (`ConfirmReturnReceivedUseCase`), и `adminOverride` (`AdminOverrideReturnUseCase`) — та же
 * доменная семантика (JSDoc DTJ-273 «Риски»: подписчик, DTJ-274, обязан быть идемпотентным по
 * `returnId`/`orderId`, не по источнику события). Потребители: `RefundOnReturnResolvedUseCase`
 * (DTJ-274, рефанд) и `InventoryFacade` (restock для СВОИХ целей аналитики/аудита — этот модуль
 * уже вызвал `ReturnsInventoryPort.restock` напрямую через порт, см. JSDoc use case).
 */
import type { ReturnDisposition, ReturnReason } from '@dorutj/contracts'

export interface ReturnConfirmedEvent {
  readonly type: 'ReturnConfirmedEvent'
  readonly returnId: string
  readonly orderId: string
  readonly reason: ReturnReason
  readonly disposition: ReturnDisposition
}
