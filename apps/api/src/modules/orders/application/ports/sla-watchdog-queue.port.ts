/** DTJ-307 (EP-12, SRS-PHT-032/033) — планирование двух BullMQ delayed job SLA сборки. Реализация — `SlaWatchdogProcessor`. */
export const SLA_WATCHDOG_QUEUE = Symbol.for('@dorutj/orders/sla-watchdog-queue')

export interface ScheduleSlaWatchdogJobsInput {
  readonly orderId: string
  readonly tenantId: string
  /** Мягкое нарушение: `pickup_sla_minutes`. */
  readonly softDelayMinutes: number
  /** Жёсткий автоотказ: `pickup_sla_minutes + pickup_sla_buffer_minutes`. */
  readonly hardDelayMinutes: number
}

export interface SlaWatchdogQueuePort {
  schedule(input: ScheduleSlaWatchdogJobsInput): Promise<void>
}