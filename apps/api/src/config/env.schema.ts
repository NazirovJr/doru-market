/**
 * Схема и валидация переменных окружения `apps/api` (DTJ-001, шаг 3 тикета).
 * Источник состава переменных — раздел «Что сделать» тикета DTJ-001 (подмножество полного
 * реестра `docs/spec/31-nfr-security-testing-devops.md` §«Наблюдаемость»/«Транспорт»,
 * относящееся к этому тикету; остальные ENV из полного реестра заводят тикеты, которым они
 * реально нужны).
 *
 * `validateEnv` вызывается синхронно ВНУТРИ `ConfigModule.forRoot({ validate })` — то есть на
 * этапе построения графа модулей (`NestFactory.create`), ДО `app.listen(...)`. Ошибка здесь
 * останавливает процесс до открытия порта (критерий приёмки DTJ-001 №4).
 */
import { z } from 'zod'

const DEFAULT_PORT = 3000
/** SRS-API-067 (ASSUMPTION 30000). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

const nodeEnvSchema = z.enum(['development', 'test', 'production'])
const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])

export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
  DATABASE_URL: z.url(
    'DATABASE_URL обязателен и должен быть валидным URL подключения PostgreSQL (postgres://user:pass@host:port/db)',
  ),
  REDIS_URL: z.url('REDIS_URL обязателен и должен быть валидным URL подключения Redis (redis://host:port)'),
  /** Дефолт зависит от NODE_ENV (info/prod, debug/dev) — вычисляется в AppConfigService. */
  LOG_LEVEL: logLevelSchema.optional(),
  CORS_STATIC_ORIGINS: z
    .string()
    .min(1, 'CORS_STATIC_ORIGINS обязателен — CSV список разрешённых origin (SRS-API-065)'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_REQUEST_TIMEOUT_MS),
})

export type EnvConfig = z.infer<typeof envSchema>

/** Форматирует ошибки Zod в человекочитаемый многострочный список — не stack trace. */
function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n')
}

/**
 * Валидатор для `ConfigModule.forRoot({ validate })`. При невалидном/отсутствующем
 * обязательном ENV бросает `Error` с понятным сообщением — Nest пробрасывает её из
 * `NestFactory.create`, `main.ts` ловит и завершает процесс ненулевым кодом (критерий №4).
 */
export function validateEnv(rawConfig: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(rawConfig)
  if (!result.success) {
    throw new Error(`Некорректная конфигурация окружения apps/api:\n${formatIssues(result.error.issues)}`)
  }
  return result.data
}
