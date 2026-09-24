/**
 * DI-регресс-щит для `PaymentsModule` (EP-10, DTJ-236) — тот же приём, что
 * `modules/orders/orders.module.full-boot.di.spec.ts`/
 * `modules/inventory/inventory.module.full-boot.di.spec.ts`: поднимает модуль ЦЕЛИКОМ через
 * `Test.createTestingModule(...).compile()`, как это делает `AppModule` при бутстрапе, а не
 * изолированный провайдер. Ловит именно тот класс дефекта, который прошёл бы `tsc`/юнит-тесты
 * с моками, но уронил бы `node dist/main.js`: параметр конструктора без `@Inject(...)`
 * (esbuild/vitest не эмитит `design:paramtypes`, DTJ-001), забытый провайдер токена, забытый
 * `imports:` межмодульной зависимости.
 *
 * На момент DTJ-236 модуль пуст (`providers: []`) — тест уже сейчас страхует граф от
 * циклических импортов/синтаксических ошибок, а с DTJ-238 (первые реальные провайдеры —
 * `MockBankProvider`/`MockBankWebhookVerifierAdapter`) начинает ловить забытый `@Inject`.
 *
 * Реальных сетевых соединений тест не открывает: `DRIZZLE_DB` — фабрика на `pg.Pool`
 * (конструктор не шлёт команд синхронно), Redis-клиент подключён с `lazyConnect: true`
 * (см. `RedisModule`/`AppConfigModule`, тот же приём, что у `orders`-аналога).
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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:payments_di',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-payments-di-spec',
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
  // DTJ-248 — `PaymentsModule` теперь импортирует `AuthModule` (`AuthGuard`/`RolesGuard` для
  // `GetOrderLedgerController`), которая резолвит `Rs256JwtSignerAdapter` при полном бутстрапе —
  // тот же приём генерации тестовой (не production) пары ключей, что
  // `orders.module.full-boot.di.spec.ts`.
  //
  // DTJ-242 — `PAYMENTS_ORDERS_PORT` теперь биндится на `OrdersFacadeAdapter` (канонический,
  // write-capable, поверх реального `OrdersFacade`), а не на `OrdersReadOnlyAdapter` (DTJ-248,
  // требовал только `DRIZZLE_DB`). `OrdersFacadeAdapter` инжектит `ORDERS_FACADE` — этот тест
  // поднимал `PaymentsModule` В ИЗОЛЯЦИИ, без `OrdersModule` в графе, поэтому `@Global()`-провайдер
  // `ORDERS_FACADE` (`orders.module.ts`, «РЕШЕНО (DTJ-242)») был недоступен, DI падал в рантайме
  // ЭТОГО теста — найдено этим же прогоном, не гипотетически. `imports` ниже получил `OrdersModule`
  // (+ `IdempotencyModule`, которую `OrdersModule` сам требует, D-EP09-18) — 1:1 набор
  // `orders.module.full-boot.di.spec.ts`, `TELEGRAM_BOT_TOKEN_NEUTRAL` добавлен в ENV выше по той
  // же причине (нужен `OrdersModule` → `AuthModule` полному дереву).
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

describe('PaymentsModule — DI-резолвинг целиком (реальный Nest-контейнер)', () => {
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
    // ДОБАВЛЕНО (DTJ-306, EP-12 §A.5) — OrdersModule теперь требует AUDIT_LOG_PORT
    // (GetHandoverOtpUseCase/RegenerateHandoverOtpUseCase), см. JSDoc orders.module.full-boot.di.spec.ts.
    const { AuditLogModule } = await import('@/common/audit/audit-log.module.js')
    const { DomainEventsModule } = await import('@/common/events/domain-events.module.js')
    const { OrdersModule } = await import('@/modules/orders/orders.module.js')
    const { PaymentsModule } = await import('./payments.module.js')

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        LoggerModule,
        SharedKernelModule,
        DatabaseModule,
        RedisModule,
        IdempotencyModule,
        AuditLogModule,
        DomainEventsModule,
        OrdersModule,
        PaymentsModule,
      ],
    }).compile()

    expect(moduleRef).toBeDefined()

    await moduleRef.close()
  }, FULL_BOOT_TIMEOUT_MS)
})
