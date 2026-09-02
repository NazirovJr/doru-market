/**
 * DI-регресс (CTO, тикет — починка `IngestInventoryBatchWithMatchingUseCase`):
 * конструктор инжектировал `CompositeInventoryMatcherService` БЕЗ `@Inject(...)`,
 * полагаясь на неявный `design:paramtypes`. По документированной конвенции этого
 * репозитория (DTJ-001) esbuild/vitest их не эмитит, поэтому Nest падает жёстко на
 * компиляции модуля («способ Б» из задания CTO).
 *
 * Этот тест поднимает `InventoryModule` ЦЕЛИКОМ (а не изолированный провайдер, как
 * `inventory.module.di.spec.ts` для `DrizzleFullSyncCompletionAdapter`) — именно так,
 * как его поднимает `AppModule` при бутстрапе: `AppConfigModule` + `LoggerModule` +
 * `SharedKernelModule` + `DatabaseModule` — все `@Global()`, в проде подключены один раз
 * в `AppModule.imports`, здесь их нужно перечислить явно, иначе изолированный тестовый
 * контейнер не увидит `PINO_LOGGER`/`CLOCK`/`ID_GENERATOR`/`DRIZZLE_DB`. Реальных сетевых
 * соединений тест не открывает: `DRIZZLE_DB` — фабрика на `pg.Pool` (конструктор не шлёт
 * команд синхронно), Redis-клиент и BullMQ `Queue` подключены с `lazyConnect: true`.
 *
 * JWT-ключи (Rs256JwtSignerAdapter, через AuthModule) генерируются здесь же в памяти —
 * `InventoryModule` не имеет отношения к auth-контенту теста, ключи нужны только чтобы
 * DI-граф вообще собрался (Ж13: тест не должен падать из-за отсутствующего ENV).
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
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-inventory-di-spec',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
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

describe('InventoryModule — DI-резолвинг целиком (реальный Nest-контейнер)', () => {
  beforeAll(() => {
    applyRequiredTestEnv()
  })

  it('компилируется через Test.createTestingModule(...).compile() без ошибок резолвинга зависимостей', async () => {
    // Динамические импорты ПОСЛЕ applyRequiredTestEnv(): AppConfigModule валидирует
    // process.env через Zod в ConfigModule.forRoot() в момент компиляции модуля, а не
    // лениво — статические import'ы верхнего уровня выполнились бы до beforeAll.
    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { InventoryModule } = await import('./inventory.module.js')

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, InventoryModule],
    }).compile()

    expect(moduleRef).toBeDefined()

    await moduleRef.close()
  })
})
