import type { ConfigService } from '@nestjs/config'
import { describe, expect, it } from 'vitest'
import { AppConfigService } from '@/config/app-config.service'
import type { EnvConfig } from '@/config/env.schema'

/**
 * Фейковый `ConfigService`, а не реальный из `@nestjs/config`: реальный при отсутствии
 * `ConfigModule.forRoot({ validate })` в графе модулей падает обратно на `process.env`
 * (тестовое окружение `vitest.config.ts` задаёт свой `LOG_LEVEL` для тишины вывода) — тест
 * обязан быть детерминированным независимо от процесса, поэтому проверяем ТОЛЬКО логику
 * `AppConfigService` поверх минимального `.get()`.
 */
function buildService(env: EnvConfig): AppConfigService {
  const configService = {
    get: <K extends keyof EnvConfig>(key: K): EnvConfig[K] => env[key],
  } as unknown as ConfigService<EnvConfig, true>
  return new AppConfigService(configService)
}

const BASE_ENV: EnvConfig = {
  NODE_ENV: 'development',
  PORT: 3000,
  DATABASE_URL: 'postgres://user:pass@localhost:5432/dorutj',
  REDIS_URL: 'redis://localhost:6379',
  CORS_STATIC_ORIGINS: 'https://dorutj.com, https://admin.dorutj.com ,',
  REQUEST_TIMEOUT_MS: 30_000,
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: 60,
  OTP_REQUEST_MAX_PER_10MIN: 3,
  OTP_REQUEST_MAX_PER_DAY: 10,
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: 20,
  OTP_RATE_LIMIT_KEY_PREFIX: 'otp_rl',
  OTP_VERIFY_MAX_ATTEMPTS: 5,
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: 300,
  SEARCH_QUERY_TIMEOUT_MS: 2_000,
  CART_HOLD_TTL_SECONDS: 900,
  PAYMENT_PROVIDER_TIMEOUT_MS: 8_000,
  PAYMENT_DRIVER: 'mock_bank',
  MOCK_BANK_AUTO_PAY_DELAY_MS: 2_000,
  BANK_INVOICE_VALIDITY_MINUTES: 15,
  PAYOUT_DRIVER: 'mock',
  MOCK_PAYOUT_DELAY_MS: 0,
  EXCEL_IMPORT_MAX_ROWS: 20_000,
  AUDIT_LOG_RETENTION_YEARS: 5,
  RATE_LIMIT_ANON_PER_MIN: 100,
  RATE_LIMIT_USER_PER_MIN: 300,
  RATE_LIMIT_1C_BATCH_PER_MIN: 20,
}

describe('AppConfigService', () => {
  it('отдаёт типизированные геттеры поверх ConfigService', () => {
    const config = buildService(BASE_ENV)

    expect(config.nodeEnv).toBe('development')
    expect(config.isDevelopment).toBe(true)
    expect(config.isProduction).toBe(false)
    expect(config.port).toBe(3000)
    expect(config.databaseUrl).toBe(BASE_ENV.DATABASE_URL)
    expect(config.redisUrl).toBe(BASE_ENV.REDIS_URL)
    expect(config.requestTimeoutMs).toBe(30_000)
    expect(config.cartHoldTtlSeconds).toBe(900)
    expect(config.paymentProviderTimeoutMs).toBe(8_000)
    expect(config.paymentDriver).toBe('mock_bank')
    expect(config.mockBankAutoPayDelayMs).toBe(2_000)
    expect(config.mockBankWebhookSecret).toBeUndefined()
    expect(config.payoutDriver).toBe('mock')
    expect(config.mockPayoutDelayMs).toBe(0)
    expect(config.auditLogRetentionYears).toBe(5)
    expect(config.rateLimitAnonPerMin).toBe(100)
    expect(config.rateLimitUserPerMin).toBe(300)
    expect(config.rateLimit1cBatchPerMin).toBe(20)
  })

  it('mockBankWebhookSecret — прокидывает значение из ENV, когда задано (DTJ-238)', () => {
    const config = buildService({ ...BASE_ENV, MOCK_BANK_WEBHOOK_SECRET: 'test-secret' })

    expect(config.mockBankWebhookSecret).toBe('test-secret')
  })

  it('alif/dc-геттеры — undefined без ENV, значение — когда задано (DTJ-239)', () => {
    const unset = buildService(BASE_ENV)
    expect(unset.alifMobiApiBaseUrl).toBeUndefined()
    expect(unset.alifMobiApiToken).toBeUndefined()
    expect(unset.alifMobiWebhookSecret).toBeUndefined()
    expect(unset.dcNextApiBaseUrl).toBeUndefined()
    expect(unset.dcNextApiToken).toBeUndefined()
    expect(unset.dcNextWebhookSecret).toBeUndefined()
    expect(unset.bankInvoiceValidityMinutes).toBe(15)

    const set = buildService({
      ...BASE_ENV,
      ALIF_MOBI_API_BASE_URL: 'https://alif.example',
      ALIF_MOBI_API_TOKEN: 'alif-token',
      ALIF_MOBI_WEBHOOK_SECRET: 'alif-secret',
      DC_NEXT_API_BASE_URL: 'https://dc.example',
      DC_NEXT_API_TOKEN: 'dc-token',
      DC_NEXT_WEBHOOK_SECRET: 'dc-secret',
    })
    expect(set.alifMobiApiBaseUrl).toBe('https://alif.example')
    expect(set.alifMobiApiToken).toBe('alif-token')
    expect(set.alifMobiWebhookSecret).toBe('alif-secret')
    expect(set.dcNextApiBaseUrl).toBe('https://dc.example')
    expect(set.dcNextApiToken).toBe('dc-token')
    expect(set.dcNextWebhookSecret).toBe('dc-secret')
  })

  it('разбирает CORS_STATIC_ORIGINS в список, отбрасывая пустые сегменты и пробелы', () => {
    const config = buildService(BASE_ENV)

    expect(config.corsStaticOrigins).toEqual(['https://dorutj.com', 'https://admin.dorutj.com'])
  })

  it('logLevel — из ENV, если задан явно', () => {
    const config = buildService({ ...BASE_ENV, LOG_LEVEL: 'warn' })

    expect(config.logLevel).toBe('warn')
  })

  it('logLevel — debug по умолчанию вне production', () => {
    const config = buildService(BASE_ENV)

    expect(config.logLevel).toBe('debug')
  })

  it('logLevel — info по умолчанию в production', () => {
    const config = buildService({ ...BASE_ENV, NODE_ENV: 'production' })

    expect(config.isProduction).toBe(true)
    expect(config.logLevel).toBe('info')
  })
})
