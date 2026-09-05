/**
 * DI-регресс-щит для `SupportModule` (EP-14, DTJ-279) — тот же приём, что `modules/payments/
 * payments.module.full-boot.di.spec.ts`: поднимает модуль ЦЕЛИКОМ через
 * `Test.createTestingModule(...).compile()`, как это делает `AppModule` при бутстрапе, а не
 * изолированный провайдер. Ловит именно тот класс дефекта, который прошёл бы `tsc`/юнит-тесты
 * с моками, но уронил бы `node dist/main.js`: параметр конструктора без `@Inject(...)`
 * (esbuild/vitest не эмитит `design:paramtypes`), забытый провайдер токена (у
 * `CreateSupportTicketUseCase` — 7 зависимостей, каждая — отдельный шанс забыть биндинг в
 * `support.module.ts`).
 */
import { generateKeyPairSync } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'

const REQUIRED_TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379/0',
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: '60',
  OTP_REQUEST_MAX_PER_10MIN: '3',
  OTP_REQUEST_MAX_PER_DAY: '10',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:support_di',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-support-di-spec',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  CART_HOLD_TTL_SECONDS: '900',
  PAYMENT_PROVIDER_TIMEOUT_MS: '8000',
  PAYMENT_DRIVER: 'mock_bank',
  MOCK_BANK_WEBHOOK_SECRET: 'test-mock-bank-webhook-secret-di-spec',
  MOCK_BANK_AUTO_PAY_DELAY_MS: '0',
  LOG_LEVEL: 'silent',
}

function applyRequiredTestEnv(): void {
  for (const [key, value] of Object.entries(REQUIRED_TEST_ENV)) {
    process.env[key] ??= value
  }
  // AppConfigModule валидирует ВЕСЬ env-schema через Zod при инициализации, независимо от того,
  // какие business-модули реально импортированы этим тестом (тот же приём, что
  // `payments.module.full-boot.di.spec.ts`) — JWT-пара нужна схеме, даже если `SupportModule`
  // сам не импортирует `AuthModule`.
  if (process.env.JWT_PRIVATE_KEY === undefined || process.env.JWT_PUBLIC_KEY === undefined) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    process.env.JWT_PRIVATE_KEY = privateKey
    process.env.JWT_PUBLIC_KEY = publicKey
    process.env.JWT_KID = 'test-v1'
  }
}

const FULL_BOOT_TIMEOUT_MS = 30_000

describe('SupportModule — DI-резолвинг целиком (реальный Nest-контейнер)', () => {
  beforeAll(() => {
    applyRequiredTestEnv()
  })

  it('компилируется через Test.createTestingModule(...).compile() без ошибок резолвинга зависимостей', async () => {
    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
    const { SupportModule } = await import('./support.module.js')

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, SupportModule],
    }).compile()

    expect(moduleRef).toBeDefined()

    await moduleRef.close()
  }, FULL_BOOT_TIMEOUT_MS)
})
