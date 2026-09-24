import type { LoggerOptions } from 'pino'
import { SENSITIVE_FIELD_REDACT_PATHS } from '@dorutj/contracts'

/** Отдельная функция — так фабрика провайдера в `inventory-sync-failed.module.ts` тестируется
 * без резолвинга всего Nest-модуля. */
export function buildWorkerLoggerOptions(): LoggerOptions {
  return { level: 'info', redact: { paths: [...SENSITIVE_FIELD_REDACT_PATHS], remove: true } }
}
