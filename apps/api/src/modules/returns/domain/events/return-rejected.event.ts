/**
 * `ReturnRejectedEvent` (EP-11, DTJ-273, SRS-DOM-056). `return_rejected` НЕ терминален — событие
 * существует для наблюдаемости (аудит/уведомления), НЕ триггерит рефанд: `RefundOnReturnResolvedUseCase`
 * (DTJ-274) явно подписывается на оба события модуля, но реагирует только на `ReturnConfirmedEvent`.
 */
export interface ReturnRejectedEvent {
  readonly type: 'ReturnRejectedEvent'
  readonly returnId: string
  readonly orderId: string
  readonly rejectionReason: string
}
