/**
 * DI-регресс-щит для `NotificationsModule` (EP-16, DTJ-368) — тот же приём, что
 * `modules/admin/admin.module.full-boot.di.spec.ts`: поднимает модуль ЦЕЛИКОМ через
 * `Test.createTestingModule(...).compile()`, как это делает `AppModule` при бутстрапе, а не
 * изолированный провайдер с моками. Ловит забытый `imports: [AuthModule]` и опечатку в токене.
 *
 * Критерий приёмки 1 DTJ-368 («DI резолвит NotificationsModule без ошибок») проверяется здесь
 * ЧАСТИЧНО — на 4 РЕАЛЬНО забинженных токенах (`IDENTITY_FACADE_PORT`,
 * `NOTIFICATIONS_REPOSITORY_PORT`, `NOTIFY_PROVIDER_TELEGRAM`, `NOTIFY_PROVIDER_IN_APP`).
 * `NOTIFY_PROVIDER_SMS`/`NOTIFY_PROVIDER_PUSH` НЕ проверяются здесь, потому что не забинжены —
 * см. JSDoc `notifications.module.ts` §«NOTIFY_PROVIDER_SMS / NOTIFY_PROVIDER_PUSH — НЕ забинжены»
 * за полным обоснованием (расхождение тикета с фактическим состоянием репозитория).
 *
 * Env-переменные — тот же набор, что `admin.module.full-boot.di.spec.ts` (`NotificationsModule`
 * тянет `AuthModule` транзитивно, требования те же — `AuthModule` резолвит `DrizzleUsersRepository`
 * и, среди прочего, `TelegramInitDataVerifierAdapter`/OTP-инфраструктуру). Реальных сетевых
 * соединений тест не открывает: `DRIZZLE_DB` — фабрика на `pg.Pool` (конструктор не шлёт команд
 * синхронно), Redis подключён лениво.
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
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-notifications-di-spec',
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

/** Реальный контейнер + живые соединения: под конкурентным прогоном 5 с может не хватить (см. admin-аналог). */
const FULL_BOOT_TIMEOUT_MS = 30_000

describe('NotificationsModule — DI-резолвинг целиком (реальный Nest-контейнер)', () => {
  beforeAll(() => {
    applyRequiredTestEnv()
  })

  it('компилируется и резолвит все 4 забинженных токена реальными инстансами', async () => {
    // Динамические импорты ПОСЛЕ applyRequiredTestEnv() — AppConfigModule валидирует
    // process.env через Zod в момент компиляции модуля, не лениво.
    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
    const { IdempotencyModule } = await import('@/common/idempotency/idempotency.module.js')
    const { NotificationsModule } = await import('./notifications.module.js')
    const { IDENTITY_FACADE_PORT } = await import('./application/ports/identity-facade.port.js')
    const { NOTIFICATIONS_REPOSITORY_PORT } = await import('./application/ports/notifications-repository.port.js')
    const { NOTIFY_PROVIDER_IN_APP, NOTIFY_PROVIDER_TELEGRAM } = await import('./application/ports/notify-provider.port.js')
    const { TelegramNotifyProvider } = await import('./infrastructure/providers/telegram-notify.provider.js')
    const { InAppNotifyProvider } = await import('./infrastructure/providers/in-app-notify.provider.js')

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, IdempotencyModule, NotificationsModule],
    }).compile()

    expect(moduleRef).toBeDefined()

    // Не просто "определено" — проверяем, что useClass реально даёт боевой класс (тот же класс
    // дефекта, что ловит inventory.module.di.spec.ts про design:paramtypes).
    expect(moduleRef.get(NOTIFY_PROVIDER_TELEGRAM)).toBeInstanceOf(TelegramNotifyProvider)
    expect(moduleRef.get(NOTIFY_PROVIDER_IN_APP)).toBeInstanceOf(InAppNotifyProvider)
    expect(moduleRef.get(IDENTITY_FACADE_PORT)).toBeDefined()
    expect(moduleRef.get(NOTIFICATIONS_REPOSITORY_PORT)).toBeDefined()

    await moduleRef.close()
  }, FULL_BOOT_TIMEOUT_MS)
})
