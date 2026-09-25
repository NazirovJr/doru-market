export const DELIVERY_OFFER_TIMEOUT_QUEUE = Symbol.for('@dorutj/delivery/offer-timeout-queue')

export interface ScheduleDeliveryOfferTimeoutInput {
  readonly offerId: string
  readonly delaySeconds: number
}

// delayed BullMQ job, jobId=offerId (идемпотентное повторное планирование).
export interface DeliveryOfferTimeoutQueuePort {
  schedule(input: ScheduleDeliveryOfferTimeoutInput): Promise<void>
  cancel(offerId: string): Promise<void> // принятый оффер больше не должен истекать
}
