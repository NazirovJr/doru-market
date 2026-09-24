/**
 * `PaymentsModule` — DI-провайдеры `PAYMENT_PROVIDER_TOKEN`/`BANK_WEBHOOK_VERIFIER_PORT` для
 * `PAYMENT_DRIVER=alif_mobi` (EP-10, DTJ-239, AC1 «компилируется без ошибок»).
 *
 * **Заменяет прежнее поведение (DTJ-238).** До этого тикета любое значение, кроме
 * `'mock_bank'`, роняло компиляцию модуля (реальных адаптеров не существовало — D-EP09-16).
 * Теперь `AlifMobiProvider`/`AlifMobiWebhookVerifierAdapter` существуют и резолвятся —
 * компиляция Nest-модуля обязана пройти УСПЕШНО. Зеркальный тест для `dc_next` —
 * `payments.module.dc-next-driver.spec.ts` (ОТДЕЛЬНЫЙ файл, не тот же — `@nestjs/config`
 * `ConfigService` с `cache: true` (`config.module.ts`) кеширует прочитанные значения ENV
 * достаточно агрессивно, что ДВА `Test.createTestingModule().compile()` разных значений
 * `PAYMENT_DRIVER` в ОДНОМ файле/воркере читают устаревшее значение из первого прогона —
 * обнаружено эмпирически при написании этого теста, найденный дефект инфраструктуры тестов,
 * не логики; отдельные ФАЙЛЫ гарантированно изолированы vitest per-file worker'ами).
 * AC3 DTJ-239 (независимость двух уровней защиты) доказывается ОТДЕЛЬНО, в
 * `test/integration/payments/payment-driver-independent-of-tenant-gate.integration.spec.ts`.
 */
import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'
import type { PaymentProvider } from './application/ports/payment-provider.port.js'
import type { BankWebhookVerifierPort } from './application/ports/bank-webhook-verifier.port.js'

/** Тот же приём (Record + loop), что `payments.module.full-boot.di.spec.ts` — цепочка `??=` даёт complexity > C3. */
const REQUIRED_TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379/0',
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
  // ASSUMPTION ENV (DTJ-239, `alif-mobi.provider.ts` JSDoc) — не используются реальным сетевым
  // вызовом в этом тесте (модуль лишь компилируется, ни один метод адаптера не вызывается).
  ALIF_MOBI_API_BASE_URL: 'https://alif.example.test',
  ALIF_MOBI_API_TOKEN: 'alif-test-token',
  ALIF_MOBI_WEBHOOK_SECRET: 'alif-test-webhook-secret',
  // DTJ-242 — `PAYMENTS_ORDERS_PORT` теперь требует `OrdersModule` в графе (см. JSDoc
  // `applyRequiredTestEnv` ниже) — полный набор ENV его собственного дерева зависимостей,
  // 1:1 `orders.module.full-boot.di.spec.ts`.
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: '60',
  OTP_REQUEST_MAX_PER_10MIN: '3',
  OTP_REQUEST_MAX_PER_DAY: '10',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:payments_alif_di',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-payments-alif-di-spec',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  CART_HOLD_TTL_SECONDS: '900',
  PAYMENT_PROVIDER_TIMEOUT_MS: '8000',
}

function applyRequiredTestEnv(): void {
  for (const [key, value] of Object.entries(REQUIRED_TEST_ENV)) {
    process.env[key] ??= value
  }
  // DTJ-248 — см. `payments.module.full-boot.di.spec.ts` (тот же приём): `PaymentsModule`
  // теперь импортирует `AuthModule`, полный бутстрап резолвит `Rs256JwtSignerAdapter`.
  // DTJ-242 — `PAYMENTS_ORDERS_PORT` биндится на `OrdersFacadeAdapter` (инжектит `ORDERS_FACADE`,
  // `@Global()` на `OrdersModule` — см. `orders.module.ts` «РЕШЕНО (DTJ-242)»), этот тест поднимал
  // `PaymentsModule` изолированно и падал в рантейме до правки — `imports` ниже получил
  // `OrdersModule`/`IdempotencyModule`, ENV выше — полный набор для дерева `OrdersModule`.
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

describe('PaymentsModule — PAYMENT_DRIVER=alif_mobi (DTJ-239)', () => {
  // `PAYMENT_DRIVER` — единственный ENV, который этот файл переопределяет НЕ через `??=`
  // (намеренно, цель теста) — обязан быть восстановлен, иначе значение протечёт в другие
  // спек-файлы того же процесса vitest (`payments.module.full-boot.di.spec.ts` ожидает 'mock_bank').
  const originalPaymentDriver = process.env.PAYMENT_DRIVER

  beforeAll(() => {
    applyRequiredTestEnv()
    process.env.PAYMENT_DRIVER = 'alif_mobi'
  })

  afterAll(() => {
    if (originalPaymentDriver === undefined) {
      delete process.env.PAYMENT_DRIVER
    } else {
      process.env.PAYMENT_DRIVER = originalPaymentDriver
    }
  })

  it('компилируется через реальный Nest-контейнер без ошибок резолвинга (AC1), резолвит alif_mobi', async () => {
    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
    const { IdempotencyModule } = await import('@/common/idempotency/idempotency.module.js')
    // ДОБАВЛЕНО (DTJ-306) — OrdersModule требует AUDIT_LOG_PORT, см. JSDoc orders.module.full-boot.di.spec.ts.
    const { AuditLogModule } = await import('@/common/audit/audit-log.module.js')
    const { DomainEventsModule } = await import('@/common/events/domain-events.module.js')
    const { OrdersModule } = await import('@/modules/orders/orders.module.js')
    const { PaymentsModule } = await import('./payments.module.js')
    const { PAYMENT_PROVIDER_TOKEN } = await import('./application/ports/payment-provider.port.js')
    const { BANK_WEBHOOK_VERIFIER_PORT } = await import('./application/ports/bank-webhook-verifier.port.js')

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

    const provider = moduleRef.get<PaymentProvider>(PAYMENT_PROVIDER_TOKEN)
    const verifier = moduleRef.get<BankWebhookVerifierPort>(BANK_WEBHOOK_VERIFIER_PORT)
    expect(provider.capabilities().providerName).toBe('alif_mobi')
    expect(verifier).toBeDefined()

    await moduleRef.close()
  }, FULL_BOOT_TIMEOUT_MS)
})
