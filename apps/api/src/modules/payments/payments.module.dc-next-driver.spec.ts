/**
 * `PaymentsModule` — DI-провайдеры `PAYMENT_PROVIDER_TOKEN`/`BANK_WEBHOOK_VERIFIER_PORT` для
 * `PAYMENT_DRIVER=dc_next` (EP-10, DTJ-239, AC1). Зеркало `payments.module.non-mock-driver.spec.ts`
 * (см. его JSDoc про причину ОТДЕЛЬНОГО файла — изоляция `ConfigService`-кэша между прогонами).
 */
import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'
import type { PaymentProvider } from './application/ports/payment-provider.port.js'
import type { BankWebhookVerifierPort } from './application/ports/bank-webhook-verifier.port.js'

const REQUIRED_TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379/0',
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
  DC_NEXT_API_BASE_URL: 'https://dc-next.example.test',
  DC_NEXT_API_TOKEN: 'dc-next-test-token',
  DC_NEXT_WEBHOOK_SECRET: 'dc-next-test-webhook-secret',
}

function applyRequiredTestEnv(): void {
  for (const [key, value] of Object.entries(REQUIRED_TEST_ENV)) {
    process.env[key] ??= value
  }
  // DTJ-248 — см. `payments.module.full-boot.di.spec.ts` (тот же приём): `PaymentsModule`
  // теперь импортирует `AuthModule`, полный бутстрап резолвит `Rs256JwtSignerAdapter`.
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

describe('PaymentsModule — PAYMENT_DRIVER=dc_next (DTJ-239)', () => {
  const originalPaymentDriver = process.env.PAYMENT_DRIVER

  beforeAll(() => {
    applyRequiredTestEnv()
    process.env.PAYMENT_DRIVER = 'dc_next'
  })

  afterAll(() => {
    if (originalPaymentDriver === undefined) {
      delete process.env.PAYMENT_DRIVER
    } else {
      process.env.PAYMENT_DRIVER = originalPaymentDriver
    }
  })

  it('компилируется через реальный Nest-контейнер без ошибок резолвинга (AC1), резолвит dc_next', async () => {
    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
    const { IdempotencyModule } = await import('@/common/idempotency/idempotency.module.js')
    const { OrdersModule } = await import('@/modules/orders/orders.module.js')
    const { PaymentsModule } = await import('./payments.module.js')
    const { PAYMENT_PROVIDER_TOKEN } = await import('./application/ports/payment-provider.port.js')
    const { BANK_WEBHOOK_VERIFIER_PORT } = await import('./application/ports/bank-webhook-verifier.port.js')

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, IdempotencyModule, OrdersModule, PaymentsModule],
    }).compile()

    const provider = moduleRef.get<PaymentProvider>(PAYMENT_PROVIDER_TOKEN)
    const verifier = moduleRef.get<BankWebhookVerifierPort>(BANK_WEBHOOK_VERIFIER_PORT)
    expect(provider.capabilities().providerName).toBe('dc_next')
    expect(verifier).toBeDefined()

    await moduleRef.close()
  }, FULL_BOOT_TIMEOUT_MS)
})
