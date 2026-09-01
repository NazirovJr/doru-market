import { z } from 'zod'

/**
 * Валидация ENV apps/worker на старте процесса (DTJ-002, шаг 3).
 * `validateWorkerEnv` бросает синхронно ДО любой попытки подключения к Redis/BullMQ —
 * это гарантирует AC4 тикета: невалидный `REDIS_URL` останавливает процесс раньше, чем он
 * успевает тронуть сеть.
 */

const DEFAULT_WORKER_HEALTH_PORT = 3001
// DTJ-181, SRS-CAT-070: retention `search_query_log` — ASSUMPTION 180 дней (без источника точнее).
const DEFAULT_SEARCH_QUERY_LOG_RETENTION_DAYS = 180

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

export const envSchema = z.object({
  REDIS_URL: z.url({ error: 'REDIS_URL обязателен и должен быть валидным URL (redis://...)' }),
  DATABASE_URL: z.url({ error: 'DATABASE_URL обязателен и должен быть валидным URL (postgres://...)' }),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(DEFAULT_WORKER_HEALTH_PORT),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  // DTJ-181: горизонт хранения apps/worker/src/jobs/prune-search-query-log.
  SEARCH_QUERY_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(DEFAULT_SEARCH_QUERY_LOG_RETENTION_DAYS),
})

export type WorkerEnv = z.infer<typeof envSchema>

export function validateWorkerEnv(config: Record<string, unknown>): WorkerEnv {
  const result = envSchema.safeParse(config)
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Невалидная конфигурация apps/worker: ${details}`)
  }
  return result.data
}
