/**
 * DTJ-307 (EP-12) — очередь `picking-sla-watchdog`. Своя копия строк и формы данных из apps/api
 * `infrastructure/jobs/sla-watchdog.processor.ts`: отдельные TS-проекты, меняется в обоих файлах сразу.
 */
export const PICKING_SLA_JOB_SOFT = 'soft'
export const PICKING_SLA_JOB_HARD = 'hard'

export interface PickingSlaWatchdogJobData {
  readonly orderId: string
  readonly tenantId: string
}