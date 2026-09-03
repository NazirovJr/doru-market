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
// DTJ-224, SRS-ORD-005..009: TTL брошенной корзины ЗАРЕГИСТРИРОВАННОГО покупателя — ASSUMPTION
// тикета (30 дней), отдельное от `CART_HOLD_TTL_SECONDS` (apps/api, мягкий Redis-резерв 15 минут).
const DEFAULT_CART_ABANDONED_TTL_DAYS = 30
// DTJ-224: гостевая корзина (`customer_id IS NULL`) — короче, `session_token` сам недолговечен.
const DEFAULT_CART_ABANDONED_GUEST_TTL_DAYS = 7
/**
 * D-EP09-15: джоба обязана отказаться работать при значении меньше 1 дня. Экспортируется —
 * `CartAbandonedCleanupJob.runOnce` (DTJ-224) переиспользует ТУ ЖЕ константу как
 * defense-in-depth guard (правило 12 AGENTS.md — не дублировать магическое число).
 */
export const MIN_CART_ABANDONED_TTL_DAYS = 1
// DTJ-238: базовый URL apps/api для исходящего вебхука MockBankAutoPayJob — ASSUMPTION (см. JSDoc ниже).
const DEFAULT_API_INTERNAL_URL = 'http://localhost:3000'
// DTJ-247, SRS-PAY-013, ticket «Технический контекст»: ASSUMPTION буквально из тикета —
// 03:00 Asia/Dushanbe, после ночной 1С-синхронизации, не одновременно с ней.
const DEFAULT_RECONCILIATION_CRON = '0 3 * * *'
// DTJ-247, SRS-PAY-042, ticket «Что сделать» п.2: ASSUMPTION буквально из тикета.
const DEFAULT_RECONCILIATION_DEDUP_DAYS = 7

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

export const envSchema = z.object({
  REDIS_URL: z.url({ error: 'REDIS_URL обязателен и должен быть валидным URL (redis://...)' }),
  DATABASE_URL: z.url({ error: 'DATABASE_URL обязателен и должен быть валидным URL (postgres://...)' }),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(DEFAULT_WORKER_HEALTH_PORT),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  // DTJ-181: горизонт хранения apps/worker/src/jobs/prune-search-query-log.
  SEARCH_QUERY_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(DEFAULT_SEARCH_QUERY_LOG_RETENTION_DAYS),
  // DTJ-224: горизонты хранения apps/worker/src/jobs/cart-cleanup (D-EP09-15 — `.min(1)`
  // отказывает процессу СТАРТОВАТЬ при значении < 1 дня; `CartAbandonedCleanupJob.runOnce`
  // добавляет тот же guard как defense-in-depth на случай прямого создания вне ConfigModule).
  CART_ABANDONED_TTL_DAYS: z.coerce
    .number()
    .int()
    .min(MIN_CART_ABANDONED_TTL_DAYS)
    .default(DEFAULT_CART_ABANDONED_TTL_DAYS),
  CART_ABANDONED_GUEST_TTL_DAYS: z.coerce
    .number()
    .int()
    .min(MIN_CART_ABANDONED_TTL_DAYS)
    .default(DEFAULT_CART_ABANDONED_GUEST_TTL_DAYS),
  // DTJ-238, SRS-PAY-005: тот же секрет/алгоритм HMAC, что верификатор apps/api
  // (`MockBankWebhookVerifierAdapter`) — `MockBankAutoPayJob` подписывает исходящий вебхук ИМ
  // ЖЕ. `optional` (не `.default`): отсутствие ENV при фактически включённом `PAYMENT_DRIVER=
  // mock_bank` — рантайм-ошибка джобы при попытке отправки, не Zod-сбой старта процесса (тот
  // же приём, что `MOCK_BANK_WEBHOOK_SECRET` в apps/api/src/config/env.schema.ts).
  MOCK_BANK_WEBHOOK_SECRET: z.string().optional(),
  // DTJ-238: самоссылающийся HTTP-вызов worker → `POST /api/v1/payments/webhook` того же
  // деплоя apps/api. ASSUMPTION этого тикета (риск «Самоссылающийся HTTP-вызов» в тексте
  // тикета: конвенции `API_INTERNAL_URL` в проекте ещё не было — заведена здесь явно, не
  // домыслена молча). Дефолт — типичный dev-адрес apps/api (`main.ts` DEFAULT_PORT=3000).
  API_INTERNAL_URL: z.url({ error: 'API_INTERNAL_URL должен быть валидным URL (http://host:port)' }).default(
    DEFAULT_API_INTERNAL_URL,
  ),
  // DTJ-247, DoD «RECONCILIATION_CRON/RECONCILIATION_DEDUP_DAYS — ENV/именованные константы».
  RECONCILIATION_CRON: z.string().min(1).default(DEFAULT_RECONCILIATION_CRON),
  RECONCILIATION_DEDUP_DAYS: z.coerce.number().int().positive().default(DEFAULT_RECONCILIATION_DEDUP_DAYS),
  // DTJ-247, SRS-PAY-014, «Риски»: инфраструктура Prometheus не подключена ни одним эпиком —
  // деградация до in-memory counter с ENV-флагом экспорта (тот же приём `z.union([literal])`,
  // что `MOCK_SMS_EXPOSE_CODE_IN_RESPONSE` в apps/api/src/config/env.schema.ts).
  RECONCILIATION_METRIC_EXPORT_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),
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
