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
}
