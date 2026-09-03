/**
 * DI-регресс-щит для `OrdersModule` (EP-09, DTJ-227) — тот же приём, что
 * `modules/inventory/inventory.module.full-boot.di.spec.ts`: поднимает модуль ЦЕЛИКОМ через
 * `Test.createTestingModule(...).compile()`, как это делает `AppModule` при бутстрапе, а не
 * изолированный провайдер. Ловит именно тот класс дефекта, который прошёл бы `tsc`/юнит-тесты
 * с моками, но уронил бы `node dist/main.js`: параметр конструктора без `@Inject(...)`
 * (esbuild/vitest не эмитит `design:paramtypes`, DTJ-001), забытый провайдер токена, забытый
 * `imports:` межмодульной зависимости (`CatalogModule`/`OnboardingModule`/`AuthModule`, все три
 * добавлены этим тикетом, D-EP09-19).
 *
 * Реальных сетевых соединений тест не открывает: `DRIZZLE_DB` — фабрика на `pg.Pool`
 * (конструктор не шлёт команд синхронно), Redis-клиент подключён с `lazyConnect: true`.
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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-orders-di-spec',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  CART_HOLD_TTL_SECONDS: '900',
  PAYMENT_PROVIDER_TIMEOUT_MS: '8000',
  LOG_LEVEL: 'silent',
}

function applyRequiredTestEnv(): void {
  for (const [key, value] of Object.entries(REQUIRED_TEST_ENV)) {
    process.env[key] ??= value
  }
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

/** Реальный контейнер + живые соединения: под конкурентным прогоном 5 с может не хватить (см. JSDoc InventoryModule-аналога). */
const FULL_BOOT_TIMEOUT_MS = 30_000

describe('OrdersModule — DI-резолвинг целиком (реальный Nest-контейнер)', () => {
  beforeAll(() => {
    applyRequiredTestEnv()
  })

  it('компилируется через Test.createTestingModule(...).compile() без ошибок резолвинга зависимостей', async () => {
    // Динамические импорты ПОСЛЕ applyRequiredTestEnv() — AppConfigModule валидирует
    // process.env через Zod в момент компиляции модуля, не лениво.
    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
    const { IdempotencyModule } = await import('@/common/idempotency/idempotency.module.js')
    const { OrdersModule } = await import('./orders.module.js')

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, IdempotencyModule, OrdersModule],
    }).compile()

    expect(moduleRef).toBeDefined()

    await moduleRef.close()
  }, FULL_BOOT_TIMEOUT_MS)
})
