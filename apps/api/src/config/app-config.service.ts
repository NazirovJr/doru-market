import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EnvConfig } from './env.schema.js'

const LOG_LEVEL_PRODUCTION_DEFAULT = 'info'
const LOG_LEVEL_DEVELOPMENT_DEFAULT = 'debug'

/**
 * Типизированный фасад над `ConfigService<EnvConfig, true>` (DTJ-001, шаг 3). Единственное
 * место, где ENV читается напрямую — остальной код инжектирует этот сервис, а не
 * `ConfigService`/`process.env` (домен и application вообще не видят ни того, ни другого).
 */
@Injectable()
export class AppConfigService {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001.
  constructor(@Inject(ConfigService) private readonly configService: ConfigService<EnvConfig, true>) {}

  get nodeEnv(): EnvConfig['NODE_ENV'] {
    return this.configService.get('NODE_ENV', { infer: true })
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production'
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development'
  }

  get port(): number {
    return this.configService.get('PORT', { infer: true })
  }

  get databaseUrl(): string {
    return this.configService.get('DATABASE_URL', { infer: true })
  }

  get redisUrl(): string {
    return this.configService.get('REDIS_URL', { infer: true })
  }

  get requestTimeoutMs(): number {
    return this.configService.get('REQUEST_TIMEOUT_MS', { infer: true })
  }

  /** SRS-NFR-038/pino: `info` в проде, `debug` в остальных окружениях, если ENV не задан явно. */
  get logLevel(): NonNullable<EnvConfig['LOG_LEVEL']> {
    const configured = this.configService.get('LOG_LEVEL', { infer: true })
    return configured ?? (this.isProduction ? LOG_LEVEL_PRODUCTION_DEFAULT : LOG_LEVEL_DEVELOPMENT_DEFAULT)
  }

  /** SRS-API-065: `CORS_STATIC_ORIGINS` — CSV в ENV, здесь уже разобран в список. */
  get corsStaticOrigins(): readonly string[] {
    return this.configService
      .get('CORS_STATIC_ORIGINS', { infer: true })
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  }

  // [DTJ-023] MockSmsProviderAdapter: dev-режим выдачи кода в лог/E2E.
  get mockSmsExposeCodeInResponse(): boolean {
    return this.configService.get('MOCK_SMS_EXPOSE_CODE_IN_RESPONSE', { infer: true }) === 'true'
  }

  // [DTJ-023] Окна rate-limit OTP-запросов (SRS-API-019).
  get otpRequestCooldownSeconds(): number {
    return this.configService.get('OTP_REQUEST_COOLDOWN_SECONDS', { infer: true })
  }

  get otpRequestMaxPer10Min(): number {
    return this.configService.get('OTP_REQUEST_MAX_PER_10MIN', { infer: true })
  }

  get otpRequestMaxPerDay(): number {
    return this.configService.get('OTP_REQUEST_MAX_PER_DAY', { infer: true })
  }

  get otpRequestMaxPerIpPerHour(): number {
    return this.configService.get('OTP_REQUEST_MAX_PER_IP_PER_HOUR', { infer: true })
  }

  get otpRateLimitKeyPrefix(): string {
    return this.configService.get('OTP_RATE_LIMIT_KEY_PREFIX', { infer: true })
  }

  // [DTJ-024, SRS-API-022] Презентационный лимит verify-попыток на один `otpRequestId`.
  get otpVerifyMaxAttempts(): number {
    return this.configService.get('OTP_VERIFY_MAX_ATTEMPTS', { infer: true })
  }

  // [DTJ-027, SRS-API-031] Максимальный возраст Telegram initData.auth_date.
  get telegramInitDataMaxAgeSeconds(): number {
    return this.configService.get('TELEGRAM_INIT_DATA_MAX_AGE_SECONDS', { infer: true })
  }

  /**
   * [DTJ-027, SRS-API-032 упрощённый] Telegram bot token для НЕЙТРАЛЬНОГО
   * тенанта (R1). `undefined` означает «не настроено» — controller бросает
   * `TelegramBotNotConfiguredError` (503). В R3 (White-Label) этот метод
   * будет заменён на резолвинг из `tenant_settings.telegram_bot_token_ref`.
   */
  get telegramBotTokenNeutral(): string | undefined {
    return this.configService.get('TELEGRAM_BOT_TOKEN_NEUTRAL', { infer: true })
  }

  /** [DTJ-185, SRS-CAT-075] `statement_timeout` композитного SQL-запроса поиска, per-route. */
  get searchQueryTimeoutMs(): number {
    return this.configService.get('SEARCH_QUERY_TIMEOUT_MS', { infer: true })
  }

  /** [DTJ-224, SRS-ORD-005] TTL мягкого Redis-резерва количества в корзине (секунды). */
  get cartHoldTtlSeconds(): number {
    return this.configService.get('CART_HOLD_TTL_SECONDS', { infer: true })
  }

  /** [DTJ-227, SRS-DOM-166] Таймаут `PaymentInvoicePort.createInvoice` (мс), см. `env.schema.ts`. */
  get paymentProviderTimeoutMs(): number {
    return this.configService.get('PAYMENT_PROVIDER_TIMEOUT_MS', { infer: true })
  }

  /** [DTJ-238, SRS-PAY-009] Активный адаптер `PaymentProvider` (`payments.module.ts` DI-ветка). */
  get paymentDriver(): EnvConfig['PAYMENT_DRIVER'] {
    return this.configService.get('PAYMENT_DRIVER', { infer: true })
  }

  /** [DTJ-238, SRS-PAY-005] HMAC-секрет мок-банка. `undefined` — не настроено (см. `env.schema.ts`). */
  get mockBankWebhookSecret(): string | undefined {
    return this.configService.get('MOCK_BANK_WEBHOOK_SECRET', { infer: true })
  }

  /** [DTJ-238, SRS-PAY-004] Задержка (мс) авто-вебхука `MockBankProvider`; `0` — выключен. */
  get mockBankAutoPayDelayMs(): number {
    return this.configService.get('MOCK_BANK_AUTO_PAY_DELAY_MS', { infer: true })
  }

  /** [DTJ-239, SRS-PAY-006] ASSUMPTION base URL Alif Mobi (research 03 §2.1) — `undefined` в R1 (не вызывается). */
  get alifMobiApiBaseUrl(): string | undefined {
    return this.configService.get('ALIF_MOBI_API_BASE_URL', { infer: true })
  }

  /** [DTJ-239, SRS-PAY-006] ASSUMPTION `Token`-заголовок авторизации Alif Mobi (research 03 §2.1). */
  get alifMobiApiToken(): string | undefined {
    return this.configService.get('ALIF_MOBI_API_TOKEN', { infer: true })
  }

  /** [DTJ-239, SRS-PAY-006] ASSUMPTION HMAC-секрет вебхука Alif Mobi (research 03 §2.7), СВОЙ, не `MOCK_BANK_WEBHOOK_SECRET`. */
  get alifMobiWebhookSecret(): string | undefined {
    return this.configService.get('ALIF_MOBI_WEBHOOK_SECRET', { infer: true })
  }

  /** [DTJ-239, SRS-PAY-006] ASSUMPTION base URL DC Next (нет публичного API — смоделировано по Alifpay, research 03 §3). */
  get dcNextApiBaseUrl(): string | undefined {
    return this.configService.get('DC_NEXT_API_BASE_URL', { infer: true })
  }

  /** [DTJ-239, SRS-PAY-006] ASSUMPTION `Token`-заголовок авторизации DC Next. */
  get dcNextApiToken(): string | undefined {
    return this.configService.get('DC_NEXT_API_TOKEN', { infer: true })
  }

  /** [DTJ-239, SRS-PAY-006] ASSUMPTION HMAC-секрет вебхука DC Next, СВОЙ, не `MOCK_BANK_WEBHOOK_SECRET`. */
  get dcNextWebhookSecret(): string | undefined {
    return this.configService.get('DC_NEXT_WEBHOOK_SECRET', { infer: true })
  }

  /** [DTJ-239, SRS-PAY-006/007] ASSUMPTION `maxInvoiceValidityMinutes` Alif Mobi/DC Next (§«Технический контекст» DTJ-239). */
  get bankInvoiceValidityMinutes(): number {
    return this.configService.get('BANK_INVOICE_VALIDITY_MINUTES', { infer: true })
  }

  /** [DTJ-253/254] Общий секрет `apps/worker → POST /api/v1/internal/orders/:id/system-cancel`. `undefined` — маршрут недоступен (см. `env.schema.ts`). */
  get internalApiKey(): string | undefined {
    return this.configService.get('INTERNAL_API_KEY', { infer: true })
  }
}
