/**
 * `ReturnInTransitEvent` (EP-11, DTJ-273, SRS-RET-002/005). Публикуется и `MarkReturnInTransitUseCase`,
 * и `RetryReturnTransitUseCase` (та же семантика перехода в `return_in_transit`, повторная попытка
 * не меняет форму события).
 */
export interface ReturnInTransitEvent {
  readonly type: 'ReturnInTransitEvent'
  readonly returnId: string
  readonly orderId: string
  readonly courierId: string
  readonly courierReturnFeeDiram: string
}
