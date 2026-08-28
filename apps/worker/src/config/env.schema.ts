import { z } from 'zod'

/**
 * Валидация ENV apps/worker на старте процесса (DTJ-002, шаг 3).
 * `validateWorkerEnv` бросает синхронно ДО любой попытки подключения к Redis/BullMQ —
 * это гарантирует AC4 тикета: невалидный `REDIS_URL` останавливает процесс раньше, чем он
 * успевает тронуть сеть.
 */

const DEFAULT_WORKER_HEALTH_PORT = 3001

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

export const envSchema = z.object({
  REDIS_URL: z.url({ error: 'REDIS_URL обязателен и должен быть валидным URL (redis://...)' }),
  DATABASE_URL: z.url({ error: 'DATABASE_URL обязателен и должен быть валидным URL (postgres://...)' }),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(DEFAULT_WORKER_HEALTH_PORT),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
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
