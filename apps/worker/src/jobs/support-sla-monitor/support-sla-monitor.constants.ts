/**
 * Константы `support-sla-monitor` (EP-14, DTJ-280) — тот же приём именования, что
 * `pickup-sla-timeout.constants.ts` (DTJ-254): `<JOB>_QUEUE`/`<JOB>_JOB_NAME`/
 * `<JOB>_SCHEDULER_ID`/`<JOB>_TZ` — строки; остальное — `Symbol` DI-токены.
 */
export const SUPPORT_SLA_MONITOR_QUEUE = 'support-sla-monitor'
export const SUPPORT_SLA_MONITOR_JOB_NAME = 'support-sla-monitor-tick'
export const SUPPORT_SLA_MONITOR_SCHEDULER_ID = 'support-sla-monitor-periodic'
export const SUPPORT_SLA_MONITOR_TZ = 'Asia/Dushanbe'

export const SUPPORT_SLA_MONITOR_QUEUE_TOKEN = Symbol('SUPPORT_SLA_MONITOR_QUEUE_TOKEN')
export const SUPPORT_SLA_MONITOR_DB_POOL = Symbol('SUPPORT_SLA_MONITOR_DB_POOL')
export const SUPPORT_SLA_MONITOR_CRON = Symbol('SUPPORT_SLA_MONITOR_CRON')
/** DTJ-280 «Что сделать» п.3 — анти-дребезг повторной эскалации, аргумент джобы (не хардкод). */
export const SUPPORT_SLA_RE_ESCALATION_MINUTES = Symbol('SUPPORT_SLA_RE_ESCALATION_MINUTES')
