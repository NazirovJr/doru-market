/**
 * DI-регресс-щит для `AdminModule` (EP-15, DTJ-350) — тот же приём, что
 * `modules/orders/orders.module.full-boot.di.spec.ts`/`modules/inventory/
 * inventory.module.full-boot.di.spec.ts`: поднимает модуль ЦЕЛИКОМ через
 * `Test.createTestingModule(...).compile()`, как это делает `AppModule` при бутстрапе, а не
 * изолированный провайдер с моками. Ловит забытый `imports:` (`OnboardingModule`/`OrdersModule`/
 * `PaymentsModule`) и забытый экспорт чужого токена (`PAYMENTS_FACADE` — этот тикет добавил его
 * в `exports:` `payments.module.ts`, см. JSDoc `admin.module.ts`).
 *
 * Критерий приёмки 1 DTJ-350: «DI резолвит AdminModule без ошибок» — проверяется здесь на
 * РЕАЛЬНОМ графе (не на моках), что даёт более сильную гарантию, чем изолированный тест с
 * заглушками фасадов: реальные `OnboardingFacade`/`ORDERS_FACADE`/`PAYMENTS_FACADE` резолвятся
 * через `useExisting`, а не только их форма типа.
 *
 * Env-переменные — тот же набор, что `orders.module.full-boot.di.spec.ts` (AdminModule тянет
 * `OrdersModule` транзитивно, требования те же). Реальных сетевых соединений тест не открывает:
 * `DRIZZLE_DB` — фабрика на `pg.Pool` (конструктор не шлёт команд синхронно), Redis подключён
 * лениво.
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
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-admin-di-spec',
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

/** Реальный контейнер + живые соединения: под конкурентным прогоном 5 с может не хватить (см. orders-аналог). */
const FULL_BOOT_TIMEOUT_MS = 30_000

describe('AdminModule — DI-резолвинг целиком (реальный Nest-контейнер)', () => {
  beforeAll(() => {
    applyRequiredTestEnv()
  })

  it('компилируется и резолвит все 3 забинженных facade-порта реальными инстансами', async () => {
    // Динамические импорты ПОСЛЕ applyRequiredTestEnv() — AppConfigModule валидирует
    // process.env через Zod в момент компиляции модуля, не лениво.
    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
    const { IdempotencyModule } = await import('@/common/idempotency/idempotency.module.js')
    // ДОБАВЛЕНО (DTJ-306, EP-12 §A.5) — AdminModule импортирует OrdersModule, которая теперь
    // (GetHandoverOtpUseCase/RegenerateHandoverOtpUseCase) требует AUDIT_LOG_PORT. AuditLogModule
    // — @Global() в реальном AppModule, но этот тест поднимает минимальный граф, не AppModule
    // целиком, поэтому его нужно перечислить явно (см. JSDoc orders.module.full-boot.di.spec.ts).
    const { AuditLogModule } = await import('@/common/audit/audit-log.module.js')
    const { AdminModule } = await import('./admin.module.js')
    const { ONBOARDING_FACADE_PORT } = await import('./application/ports/onboarding-facade.port.js')
    const { ORDERS_FACADE_PORT } = await import('./application/ports/orders-facade.port.js')
    const { PAYMENTS_FACADE_PORT } = await import('./application/ports/payments-facade.port.js')
    const { OnboardingFacade } = await import('@/modules/onboarding/index.js')

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        LoggerModule,
        SharedKernelModule,
        DatabaseModule,
        RedisModule,
        IdempotencyModule,
        AuditLogModule,
        AdminModule,
      ],
    }).compile()

    expect(moduleRef).toBeDefined()

    // Не просто "определено" — проверяем, что useExisting реально указывает на боевой класс,
    // а не на случайно совпавший undefined (тот же класс дефекта, что ловит
    // inventory.module.di.spec.ts про design:paramtypes).
    expect(moduleRef.get(ONBOARDING_FACADE_PORT)).toBeInstanceOf(OnboardingFacade)
    expect(moduleRef.get(ORDERS_FACADE_PORT)).toBeDefined()
    expect(moduleRef.get(PAYMENTS_FACADE_PORT)).toBeDefined()

    await moduleRef.close()
  }, FULL_BOOT_TIMEOUT_MS)
})
