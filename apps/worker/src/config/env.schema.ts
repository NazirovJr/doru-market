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
// DTJ-253, SRS-ORD-032, ticket «Что сделать» п.2: ASSUMPTION буквально из тикета — каждые
// 2 минуты (короче минимального разумного платёжного окна на оплату).
const DEFAULT_UNPAID_ORDER_TIMEOUT_CRON = '*/2 * * * *'
// DTJ-249, SRS-PAY-030, ticket «Технический контекст»: ASSUMPTION буквально из тикета —
// ежечасно (pending→due — единственный переход payout, управляемый временем, D-19).
const DEFAULT_PAYOUT_SCHEDULER_CRON = '0 * * * *'
// DTJ-251, SRS-PAY-036: ASSUMPTION — 00:30 Asia/Dushanbe (после полуночи, период [вчера,сегодня)
// уже закрыт к моменту запуска, см. JSDoc cash-commission-aggregation.scheduler.ts).
const DEFAULT_CASH_COMMISSION_AGGREGATION_DAILY_CRON = '30 0 * * *'
// DTJ-251, ticket «Что сделать» п.3: ASSUMPTION — воскресенье 23:50 Asia/Dushanbe (буквальный
// текст тикета «23:59», округлено на 10 минут раньше — запас на выполнение тика до смены дня).
const DEFAULT_CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_CRON = '50 23 * * 0'
// DTJ-252, ticket «Что сделать» п.1: ASSUMPTION буквально из тикета — «ежедневно»; 01:00
// Asia/Dushanbe, ПОСЛЕ ежедневного тика CashCommissionAggregationJob (00:30) и weekly-issue
// (воскресенье 23:50) — просроченный инвойс уже гарантированно issued к моменту проверки, не
// гонка с ещё формируемым draft/только что issued инвойсом того же тика.
const DEFAULT_BILLING_INVOICE_OVERDUE_CRON = '0 1 * * *'
// DTJ-252, ticket «Что сделать» п.1: ASSUMPTION буквально из тикета — `GRACE_PERIOD_DAYS=3`.
const DEFAULT_BILLING_INVOICE_OVERDUE_GRACE_PERIOD_DAYS = 3
// DTJ-254, SRS-ORD-035, ticket «Что сделать» п.1: ASSUMPTION буквально из тикета — каждые
// 2 минуты (короче минимального разумного `pickup_sla_minutes`, дефолт 7).
const DEFAULT_PICKUP_SLA_TIMEOUT_CRON = '*/2 * * * *'
// DTJ-280, SRS-ADM-076, ticket «Что сделать» п.4: ASSUMPTION буквально из тикета — каждые 5 минут.
const DEFAULT_SUPPORT_SLA_MONITOR_CRON = '*/5 * * * *'
// DTJ-280, ticket «Что сделать» п.3: ASSUMPTION буквально из тикета — 30 минут анти-дребезг
// повторной эскалации (не растить priority на каждый тик шедулера для уже эскалированного тикета).
const DEFAULT_SUPPORT_SLA_RE_ESCALATION_MINUTES = 30
// DTJ-250: ASSUMPTION этого тикета (не зафиксирована буквально в тексте) — ежечасно, ТА ЖЕ
// каденция, что сосед `PayoutSchedulerJob` (DTJ-249, ticket DTJ-249 «Технический контекст»).
const DEFAULT_PAYOUT_EXECUTION_CRON = '0 * * * *'
// DTJ-250, ticket «Что сделать» п.3: ASSUMPTION лимит на батч — не найден общий паттерн
// батчинга в кодовой базе на момент реализации (проверено), заведён локально этим тикетом.
const DEFAULT_PAYOUT_BATCH_SIZE = 50

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
  // DTJ-253, DoD «UNPAID_ORDER_TIMEOUT_CRON — именованная ENV-константа».
  UNPAID_ORDER_TIMEOUT_CRON: z.string().min(1).default(DEFAULT_UNPAID_ORDER_TIMEOUT_CRON),
  // DTJ-254, DoD «PickupSlaTimeoutJob интервал — именованная ENV-константа».
  PICKUP_SLA_TIMEOUT_CRON: z.string().min(1).default(DEFAULT_PICKUP_SLA_TIMEOUT_CRON),
  // DTJ-280, DoD «интервал шедулера и анти-дребезг эскалации — через конфигурацию/ENV».
  SUPPORT_SLA_MONITOR_CRON: z.string().min(1).default(DEFAULT_SUPPORT_SLA_MONITOR_CRON),
  SUPPORT_SLA_RE_ESCALATION_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_SUPPORT_SLA_RE_ESCALATION_MINUTES),
  // DTJ-250, DoD «PAYOUT_BATCH_SIZE/MOCK_PAYOUT_DELAY_MS — именованные ENV-константы» (интервал
  // джобы — тот же приём, хоть и не назван буквально тикетом, см. DEFAULT_PAYOUT_EXECUTION_CRON).
  PAYOUT_EXECUTION_CRON: z.string().min(1).default(DEFAULT_PAYOUT_EXECUTION_CRON),
  PAYOUT_BATCH_SIZE: z.coerce.number().int().positive().default(DEFAULT_PAYOUT_BATCH_SIZE),
  // DTJ-253/254/250: общий секрет `apps/worker → POST /api/v1/internal/orders/:id/system-cancel`,
  // `POST /api/v1/internal/payouts/transfer-batch` (`apps/api`, см. JSDoc
  // `system-order-cancel.client.ts`/`payout-transfer-batch.client.ts`). `optional`, ТОТ ЖЕ приём,
  // что `MOCK_BANK_WEBHOOK_SECRET` — отсутствие ENV даёт рантайм-ошибку джобы при попытке вызова,
  // не Zod-сбой старта процесса.
  INTERNAL_API_KEY: z.string().optional(),
  // DTJ-249, DoD «PAYOUT_SCHEDULER_CRON — именованная ENV-константа».
  PAYOUT_SCHEDULER_CRON: z.string().min(1).default(DEFAULT_PAYOUT_SCHEDULER_CRON),
  // DTJ-251, ticket «Что сделать» п.2/3: два раздельных расписания одной джобы.
  CASH_COMMISSION_AGGREGATION_DAILY_CRON: z.string().min(1).default(DEFAULT_CASH_COMMISSION_AGGREGATION_DAILY_CRON),
  CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_CRON: z.string().min(1).default(DEFAULT_CASH_COMMISSION_AGGREGATION_WEEKLY_ISSUE_CRON),
  // DTJ-252, DoD «GRACE_PERIOD_DAYS — именованная ENV-константа»/«BillingInvoiceOverdueJob (BullMQ repeatable, ежедневно)».
  BILLING_INVOICE_OVERDUE_CRON: z.string().min(1).default(DEFAULT_BILLING_INVOICE_OVERDUE_CRON),
  BILLING_INVOICE_OVERDUE_GRACE_PERIOD_DAYS: z.coerce.number().int().positive().default(DEFAULT_BILLING_INVOICE_OVERDUE_GRACE_PERIOD_DAYS),
  // DTJ-370: та же переменная, что `apps/api/src/config/env.schema.ts` (ОДИН бот нейтрального
  // тенанта, `TelegramNotifyProvider` JSDoc §«Токен») — `NotificationDispatchProcessor` шлёт
  // Telegram-сообщения worker'ом, apps/api не может импортировать apps/worker и наоборот, поэтому
  // ОБА процесса читают ОДНО и то же имя ENV независимо. `optional`, тот же приём, что
  // `MOCK_BANK_WEBHOOK_SECRET` — отсутствие даёт рантайм-`{success:false}` джобы, не Zod-сбой старта.
  TELEGRAM_BOT_TOKEN_NEUTRAL: z.string().optional(),
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
