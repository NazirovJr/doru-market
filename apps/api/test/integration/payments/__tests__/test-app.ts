/**
 * `test-app.ts` (EP-10, DTJ-242) — utility для Supertest-интеграции `PaymentsWebhookController`
 * против НАСТОЯЩИХ Postgres/Redis (D-EP09-14 — Testcontainers не используются). 1:1 приём, что
 * `test/integration/orders/__tests__/test-app.ts` (DTJ-226/241) — заведён ЗАНОВО (не
 * импортирован оттуда: `test/**` не подпадает под `no-cross-module-deep-import` depcruise, но
 * кросс-суитная связь между файлами РАЗНЫХ исполнителей — источник хрупкости при параллельной
 * работе, тот же класс необходимого дублирования, что `drizzle-tx.util.ts` этого тикета).
 *
 * `imports: [OrdersModule]` — ДОСТАТОЧНО: `OrdersModule` теперь `@Global()` (`orders.module.ts`,
 * «РЕШЕНО (DTJ-242)») и САМ импортирует `PaymentsModule` (DTJ-227/241) — оба модуля целиком
 * попадают в граф ОДНИМ импортом, `PaymentsWebhookController`/`HandlePaymentPaymentWebhookUseCase`
 * резолвятся без отдельного `imports: [PaymentsModule]`.
 *
 * `rawBody: true` — ЕДИНСТВЕННОЕ отличие от `orders`-харнесса: `PaymentsWebhookController`
 * читает `request.rawBody` (см. JSDoc контроллера/`main.ts`) — без этого флага здесь HMAC-тесты
 * подписывали бы байты, которые контроллер не увидел бы (`rawBody` был бы `undefined`).
 */
import { randomUUID } from 'node:crypto'
import { type Server } from 'node:http'
import { type INestApplication, VersioningType } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import type Redis from 'ioredis'
import type { Pool } from 'pg'
import { AppConfigService } from '@/config/app-config.service.js'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { ResponseInterceptor } from '@/common/http/interceptors/response.interceptor.js'
import { OrdersModule } from '@/modules/orders/orders.module.js'
import { SharedKernelModule } from '@/shared-kernel/shared-kernel.module.js'
import { LoggerModule } from '@/common/logging/logger.module.js'
import { IdempotencyModule } from '@/common/idempotency/idempotency.module.js'
import { RequestContext } from '@/common/context/request-context.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'

/** Тестовый ключ, НЕ секрет (Ж13) — идентичен `test/integration/orders/__tests__/test-app.ts`. */
const TEST_JWT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDEARjrYl91iNxF
3YVeQZ430Q7TeFxZ7HN7jqKIEXKvNyU/oTk3Dkd/m1l13uGqpmrtLK/XqH0Gg2mT
brJRBLbaTYv1UKbTUBukaRbGhsz8tWA9T1PL5uqeiPoYQs+HAM6lA1cOciITae85
SH39PbW8r9JneN5yWIfU61QprHmqhmlkespOmYIefhs1Vz8Ml00ykOo7edOMc6JQ
ztZbmdFPtQiO26rYggeoe+U6C0+xv0M/nHOrwrhs5vr1mr4vkjunTZC29TU03pjJ
HEzHG+UVvs2yrmmFfO3Y+1iyuWum6ObiIhn1xUdYf4iTZ21kulVlTdjb2lkQp0Ri
2CihgFW3AgMBAAECggEABTt4RFRYcwVHyA+tT0JWLGxGxotof7gJrys0GIjKtHW2
51dw9RDLBNOLVFOyV4FgylsOiKXFTKa2a0qhtPr4vKQkT9Sq12pEiqOJiZwwnbBj
1M8o0AEmkzvZ3UrvSk3RtmL78HVIhpcl3TQbtOZwUwyog72cxpWpbpwnn4Msrkoj
RqBx6NyhQq9UIpk4iP1fVbSNQO0rwLCSbVX4SG1te6sXKlQm2VEVBMuwo4LPG/w8
+cFKJjUDvYiC/MShGAQfWlhGCqVlhXB+4JX3ioI7wvm3lK/antJ5eGhV5lQO9NyY
619qCj95IxSgrxAR/P240wdyGKVwqwJAh0dQShEPoQKBgQDzpnco0s883mRiqr+1
FMaRUH80ohFeT5AWXPH76ORUPzANrfwbXrLQYWEa1n8HM1p9l6gY/Qyp2yufiZnr
1a90F5847gHoQ78aHQO+WHlDfqK8iGmgcQPH6AYJRr0M4KxKQyyjz0GGV/vKZpk5
WfguQSOEZs82GvSX01/cxLtrVwKBgQDN8GRGWYsveYVe/+T/80rxbXZ2PhxXaEz1
ZSKiWLR6MnTohrBqwJGi2KuEomc+pY7+SSsq+ux/mat6QY0YyVsUdg4hgls95Ob3
TrBHikBCcmJxPkB/O2HpmTCsm8ST5ycPfg86WhfarLQQv8EZeX9horL7QdLT4JC4
e0zBA9xMoQKBgQDF9nrasG2xBwCJKjKY7khnyP+RxBxYhEyN3va9tnvN94kTlElB
869Vn8lGBQEw2IitgosRwoiHeYv4E9T7yKLFsGut1bO3A1RB41EnVrswG7QderhX
o3tu8RX2c4Mm82UI8YtTjRGwFcx+pt3Xu0HqUwKIkP/K9hvFP/ijZzTgAQKBgQCV
Vt8QmPyzB7es5XqGFULigtOl+XKJ/CvaxGVyP0tZVd+rg4jJUS4LXn46555hMqPY
SO0R9PatrZ1JQeH0+Ieg9d9Xc3WBE85dxuVUa7Afv10d69vPqBtfz+QZN7g83SJZ
PLwEP7MOs7C8eKGqPI4gGmEajWg6l526+kb1rTwDIQKBgB+V4z8skw4IXnQ934n/
nblbPu+2y9Y74eCULe+i8RXE9zcG1KOsSs4e7jDm3HKhXlljVT2xZT8YHWxhBP3j
0O//tkV0DVL8VgrLtqnkkOl5sGUwxYTI7fQwh6pC+JMJdm+NoGB3Enue6WPKS/QQ
nyAA7xR2Sj44+PgsgK3GEq8r
-----END PRIVATE KEY-----
`

const TEST_JWT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxAEY62JfdYjcRd2FXkGe
N9EO03hcWexze46iiBFyrzclP6E5Nw5Hf5tZdd7hqqZq7Syv16h9BoNpk26yUQS2
2k2L9VCm01AbpGkWxobM/LVgPU9Ty+bqnoj6GELPhwDOpQNXDnIiE2nvOUh9/T21
vK/SZ3jecliH1OtUKax5qoZpZHrKTpmCHn4bNVc/DJdNMpDqO3nTjHOiUM7WW5nR
T7UIjtuq2IIHqHvlOgtPsb9DP5xzq8K4bOb69Zq+L5I7p02QtvU1NN6YyRxMxxvl
Fb7Nsq5phXzt2PtYsrlrpujm4iIZ9cVHWH+Ik2dtZLpVZU3Y29pZEKdEYtgooYBV
twIDAQAB
-----END PUBLIC KEY-----
`

/** `MOCK_BANK_WEBHOOK_SECRET` (ENV-заглушка, DTJ-242) — тестовый ключ, НЕ секрет (Ж13). Порт
 *  ОПЦИОНАЛЕН (`env.schema.ts`) — без явного значения ЛЮБАЯ подпись отвергается
 *  (`verifyHmacSha256Signature`: `secret === undefined` → `false`), значит валидные-подпись
 *  тесты обязаны его задать САМИ. */
export const TEST_MOCK_BANK_WEBHOOK_SECRET = 'test-mock-bank-webhook-secret-dtj242'

const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379/0',
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: '60',
  OTP_REQUEST_MAX_PER_10MIN: '3',
  OTP_REQUEST_MAX_PER_DAY: '10',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_payments',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'error',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-payments',
  CART_HOLD_TTL_SECONDS: '900',
  PAYMENT_DRIVER: 'mock_bank',
  MOCK_BANK_WEBHOOK_SECRET: TEST_MOCK_BANK_WEBHOOK_SECRET,
  MOCK_BANK_AUTO_PAY_DELAY_MS: '0',
}

function applyTestEnv(): void {
  // `??=` — НЕ перетирает `DATABASE_URL`/`REDIS_URL`, уже выставленные `vitest.integration.
  // config.ts`'s `test.env` (которые сами читают внешний `process.env.DATABASE_URL`/`REDIS_URL`
  // от исполнителя) — тот же приём, что `test/integration/orders/__tests__/test-app.ts`.
  // Плоское присваивание здесь ранее ЗАТИРАЛО их дефолтами `test`/`db 0`, из-за чего фикстуры
  // сеялись в `dorutj_test2`, а сам Nest-приложение под тестом подключалось к другой БД
  // (`test`) — все запросы падали 500 «relation does not exist» (найденный дефект своего же
  // теста, починен на этапе прогона).
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
}

export interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

export async function createTestApp(): Promise<TestApp> {
  applyTestEnv()
  const moduleRef = await Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, IdempotencyModule, OrdersModule],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { rawBody: true })
  const config = app.get(AppConfigService)
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)
  installDefaultRequestContextHook(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  const httpServer = app.getHttpServer()
  return {
    app,
    httpServer,
    close: async (): Promise<void> => {
      const db = app.get<DrizzleDb>(DRIZZLE_DB) as DrizzleDb & { $client: Pool }
      const redis = app.get<Redis>(REDIS_CLIENT)
      await app.close()
      await db.$client.end()
      redis.disconnect()
    },
  }
}

/** 1:1 `test/integration/orders/__tests__/test-app.ts` — `RequestContext.patch()` no-op'ает без активного `.run()` (см. её JSDoc). */
function installDefaultRequestContextHook(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance()
  fastify.addHook('onRequest', (_request, _reply, done) => {
    if (RequestContext.get() !== undefined) {
      done()
      return
    }
    RequestContext.run({ requestId: randomUUID(), tenantId: null, userId: null, role: null }, done)
  })
}
