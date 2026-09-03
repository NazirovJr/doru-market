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
/** [DTJ-023, SRS-API-019] Defaults for OTP rate-limit windows. */
const DEFAULT_OTP_COOLDOWN_SECONDS = 60
const DEFAULT_OTP_MAX_PER_10MIN = 3
const DEFAULT_OTP_MAX_PER_DAY = 10
const DEFAULT_OTP_MAX_PER_IP_PER_HOUR = 20
const DEFAULT_OTP_RATE_LIMIT_KEY_PREFIX = 'otp_rl'
/** [DTJ-024, SRS-API-022] Лимит неверных попыток verify для одного `otpRequestId`. */
const DEFAULT_OTP_VERIFY_MAX_ATTEMPTS = 5
/** [DTJ-027, SRS-API-031 шаг 7] Максимальный возраст Telegram `initData.auth_date`. */
const DEFAULT_TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = 300
/** [DTJ-185, SRS-CAT-075] `statement_timeout` композитного SQL-запроса поиска (ASSUMPTION спеки). */
const DEFAULT_SEARCH_QUERY_TIMEOUT_MS = 2_000
/** [DTJ-224, SRS-ORD-005] TTL мягкого Redis-резерва количества в корзине — ASSUMPTION тикета (900с = 15 мин). */
const DEFAULT_CART_HOLD_TTL_SECONDS = 900
/** [DTJ-227, SRS-DOM-166] Таймаут синхронного вызова `PaymentInvoicePort.createInvoice` после
 * commit транзакции группы — ASSUMPTION тикета (8000мс), см. «Что сделать» п.2.4.d. */
const DEFAULT_PAYMENT_PROVIDER_TIMEOUT_MS = 8_000
/** [DTJ-238, SRS-PAY-004] Задержка авто-вебхука MockBankProvider — ASSUMPTION тикета (2000мс). */
const DEFAULT_MOCK_BANK_AUTO_PAY_DELAY_MS = 2_000
/**
 * [DTJ-239, SRS-PAY-006/007] `maxInvoiceValidityMinutes` ASSUMPTION для Alif Mobi/DC Next —
 * research 03 §2.2 не документирует TTL счёта явно (только `payment_timeout` продуктового
 * уровня, §7 того же документа, 15 минут) — тот же ASSUMPTION-ориентир, что
 * `MOCK_BANK_MAX_INVOICE_VALIDITY_MINUTES` (DTJ-238), НЕ гарантированно идентичен реальному
 * банку РТ (уточняется R3, реальный контракт).
 */
const DEFAULT_BANK_INVOICE_VALIDITY_MINUTES = 15
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR
const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY

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
  // [DTJ-023] Dev-режим MockSmsProviderAdapter: true → код OTP в логе/E2E-ответе.
  // По умолчанию false (SRS-API-021: сырой код не покидает стек в проде).
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: z
    .union([z.literal('true'), z.literal('false')])
    .default('false'),
  // [DTJ-023] Rate-limit окна OTP-запросов (SRS-API-019). Дефолты — из спеки.
  OTP_REQUEST_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(DEFAULT_OTP_COOLDOWN_SECONDS),
  OTP_REQUEST_MAX_PER_10MIN: z.coerce.number().int().positive().default(DEFAULT_OTP_MAX_PER_10MIN),
  OTP_REQUEST_MAX_PER_DAY: z.coerce.number().int().positive().default(DEFAULT_OTP_MAX_PER_DAY),
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(DEFAULT_OTP_MAX_PER_IP_PER_HOUR),
  // [DTJ-023] Префикс ключей rate-limit (multi-tenant изоляция).
  OTP_RATE_LIMIT_KEY_PREFIX: z.string().min(1).default(DEFAULT_OTP_RATE_LIMIT_KEY_PREFIX),
  // [DTJ-024, SRS-API-022] Презентационный лимит неверных попыток verify
  // на один `otpRequestId` (Redis-счётчик `otp_verify_attempts:{id}`).
  // 6-я попытка (любой код) → `423 OTP_LOCKED`, ключ живёт до `expiresAt`.
  OTP_VERIFY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(DEFAULT_OTP_VERIFY_MAX_ATTEMPTS),
  // [DTJ-027, SRS-API-031] Telegram TWA auth: max возраст `initData.auth_date`.
  // Дефолт 300 секунд (5 минут) — Telegram рекомендует.
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_TELEGRAM_INIT_DATA_MAX_AGE_SECONDS),
  // [DTJ-027, SRS-API-032 упрощённый] Telegram bot token для НЕЙТРАЛЬНОГО
  // тенанта (R1). В R3 (White-Label) — резолвинг из `tenant_settings`.
  // `optional` (НЕ `.default`): отсутствие ENV → `503 telegram_bot_not_configured`
  // (см. `TelegramBotNotConfiguredError`). Сделано опциональным потому, что
  // dev/test среды могут не иметь настоящего токена.
  TELEGRAM_BOT_TOKEN_NEUTRAL: z.string().optional(),
  // [DTJ-185, SRS-CAT-075] Таймаут композитного SQL-запроса поиска (per-route `statement_timeout`,
  // НЕ глобальная настройка пула — см. `postgres-search.adapter.ts`). Превышение → 57014
  // query_canceled → `SearchTemporarilyDegradedError` → 503, не generic 500.
  SEARCH_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_SEARCH_QUERY_TIMEOUT_MS),
  // [DTJ-224, SRS-ORD-005] TTL мягкого резерва Redis (`cart:hold:*`) — независим от
  // `CART_ABANDONED_TTL_DAYS` (apps/worker, хранение самой корзины) — два разных временных окна.
  CART_HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(DEFAULT_CART_HOLD_TTL_SECONDS),
  // [DTJ-227, SRS-DOM-166] Таймаут createInvoice — таймаут/ошибка НЕ откатывает уже
  // закоммиченный заказ (D-EP09-17), группа помечается `paymentPending: true`.
  PAYMENT_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_PAYMENT_PROVIDER_TIMEOUT_MS),
  // [DTJ-238, SRS-PAY-009] Единственный переключатель адаптера PaymentProvider на уровне DI
  // (`{ provide: PAYMENT_PROVIDER_TOKEN, useClass: ... }`, payments.module.ts) — ОДНА
  // инсталляция API обслуживает ОДИН PAYMENT_DRIVER глобально, не per-tenant в R1. Дефолт
  // 'mock_bank' — единственный реально включённый провайдер в R1-проде (Charter DoD п.7).
  PAYMENT_DRIVER: z.enum(['mock_bank', 'alif_mobi', 'dc_next']).default('mock_bank'),
  // [DTJ-238, SRS-PAY-005] HMAC-секрет мок-банка — ТОТ ЖЕ алгоритм/код-путь верификации, что
  // реальные адаптеры (§5.2). `optional` (не `.default`): dev-окружение генерирует значение при
  // первом запуске (`.env.example` — плейсхолдер), тесты подставляют свой. Отсутствие ENV при
  // фактическом использовании mock_bank — рантайм-ошибка адаптера/верификатора, не Zod-сбой
  // старта процесса (тот же приём, что `TELEGRAM_BOT_TOKEN_NEUTRAL`).
  MOCK_BANK_WEBHOOK_SECRET: z.string().optional(),
  // [DTJ-238, SRS-PAY-004] Задержка (мс) авто-вебхука MockBankProvider после createInvoice/
  // refund. `0` — авто-вебхук выключен вовсе (нужно тестам, проверяющим именно
  // `pending_payment`). ASSUMPTION дефолта — 2000 (тикет).
  MOCK_BANK_AUTO_PAY_DELAY_MS: z.coerce.number().int().nonnegative().default(DEFAULT_MOCK_BANK_AUTO_PAY_DELAY_MS),
  // [DTJ-239, SRS-PAY-006/008] Alif Mobi/DC Next — заготовки адаптеров (R3 включение).
  // ASSUMPTION (research 03 §2.1/§2.7): `Token`-заголовок авторизации + base URL API,
  // HMAC-секрет вебхука отдельно от `MOCK_BANK_WEBHOOK_SECRET` (у каждого банка свой ключ).
  // `optional` — R1 никогда фактически не вызывает эти адаптеры (PAYMENT_DRIVER=mock_bank по
  // умолчанию, включение реального трафика физически заблокировано
  // tenant_settings.enabledPaymentMethods, см. payments.module.ts).
  ALIF_MOBI_API_BASE_URL: z.string().optional(),
  ALIF_MOBI_API_TOKEN: z.string().optional(),
  ALIF_MOBI_WEBHOOK_SECRET: z.string().optional(),
  DC_NEXT_API_BASE_URL: z.string().optional(),
  DC_NEXT_API_TOKEN: z.string().optional(),
  DC_NEXT_WEBHOOK_SECRET: z.string().optional(),
  BANK_INVOICE_VALIDITY_MINUTES: z.coerce.number().int().positive().default(DEFAULT_BANK_INVOICE_VALIDITY_MINUTES),
})

/** [DTJ-023] Секунды в N минутах/часах/дне — для use case расчёта rate-limit окон. */
export const TIME_CONSTANTS = {
  SECONDS_PER_MINUTE,
  SECONDS_PER_HOUR,
  SECONDS_PER_DAY,
  MINUTES_PER_HOUR,
  HOURS_PER_DAY,
} as const

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
