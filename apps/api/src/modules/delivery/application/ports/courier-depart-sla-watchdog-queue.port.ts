export const COURIER_DEPART_SLA_WATCHDOG_QUEUE = Symbol.for('@dorutj/delivery/courier-depart-sla-watchdog-queue')

export interface ScheduleCourierDepartSlaWatchdogInput {
  readonly deliveryAssignmentId: string
  readonly delayMinutes: number
}

// delayed BullMQ job, jobId=deliveryAssignmentId (идемпотентное повторное планирование, тот же приём, что DeliveryOfferTimeoutQueuePort).
export interface CourierDepartSlaWatchdogQueuePort {
  schedule(input: ScheduleCourierDepartSlaWatchdogInput): Promise<void>
  cancel(deliveryAssignmentId: string): Promise<void> // курьер выехал / назначение переназначено — старый таймер больше не нужен
}
