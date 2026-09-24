/**
 * `AuditLogModule` (EP-16, DTJ-374) — DI-тест AC4: `AuditLogPort` резолвится в модуле,
 * который НЕ импортирует `AuditLogModule` явно (подтверждение `@Global()`-регистрации, см.
 * JSDoc самого модуля). `app.module.spec.ts` (Ж2) уже поднимает `AppModule` целиком и
 * КОСВЕННО доказывает, что регистрация `AuditLogModule` в корне не ломает граф — этот файл
 * ПРЯМО воспроизводит буквальный сценарий AC4: «гипотетический тестовый модуль», не
 * упомянутый ни в одном `imports: [...]`, всё равно получает порт.
 *
 * `AuditLogModule` теперь тянет `AuthModule` (нужен контроллеру) транзитивно с реальными
 * `Database`/`Redis`/`Config` модулями — локальный мок `DRIZZLE_DB` больше не покрывает граф,
 * поэтому здесь реальный граф целиком (без сетевых соединений — те же ленивые конструкторы).
 */
import { generateKeyPairSync } from 'node:crypto'
import { Inject, Injectable, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { beforeAll, describe, expect, it } from 'vitest'
import { AuditLogModule } from './audit-log.module.js'
import { AUDIT_LOG_PORT, type AuditLogPort } from './audit-log.port.js'

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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_audit_log',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-audit-log-module-spec',
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
    process.env.JWT_KID = 'test-v1-audit-log-module'
  }
}

/** «Гипотетический тестовый модуль» из буквального текста AC4 — намеренно НЕ импортирует `AuditLogModule`. */
@Injectable()
class FakeConsumerService {
  public constructor(@Inject(AUDIT_LOG_PORT) public readonly auditLog: AuditLogPort) {}
}

@Module({ providers: [FakeConsumerService] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
class FakeConsumerModule {}

const FULL_BOOT_TIMEOUT_MS = 30_000

describe('AuditLogModule — @Global() (DTJ-374, AC4)', () => {
  beforeAll(() => {
    applyRequiredTestEnv()
  })

  it('AuditLogPort резолвится в потребителе БЕЗ imports: [AuditLogModule] в его собственном модуле', async () => {
    // Динамические импорты после applyRequiredTestEnv() — конфиг валидируется при компиляции модуля.
    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, AuditLogModule, FakeConsumerModule],
    }).compile()

    const consumer = moduleRef.get(FakeConsumerService)
    expect(consumer.auditLog).toBeDefined()
    expect(typeof consumer.auditLog.write).toBe('function')

    await moduleRef.close()
  }, FULL_BOOT_TIMEOUT_MS)
})
