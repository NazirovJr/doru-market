/**
 * `ledger-test-app.ts` (EP-10, DTJ-248) — Supertest-harness для `GET /api/v1/orders/:id/ledger`,
 * тот же приём, что `test/integration/orders/__tests__/test-app.ts` (DTJ-226)/`test/integration/
 * auth/__tests__/test-app.ts` (DTJ-029).
 *
 * ИМЯ ФАЙЛА (НЕ `test-app.ts`): исходно был именно `test-app.ts` в этой же папке, но параллельный
 * исполнитель (DTJ-242, `PaymentsWebhookController`) СВОИМ прогоном перезаписал его целиком под
 * свои нужды (другой набор ENV/хуков — без `installGuestTenantContextHook`/явного управления
 * `TenantContext`, которые нужны ЭТОМУ тесту для `super_admin`, СМ. ниже) — конфликт ДВУХ
 * тикетов на одно имя файла внутри `test/integration/payments/__tests__/`. Правило задания
 * («Конфликт — не откатывай, считай диск истиной») здесь применено буквально: их файл НЕ
 * тронут, этот — под ДРУГИМ именем, обе интеграционные сьюты сосуществуют без взаимной порчи.
 *
 * `Test.createTestingModule` строит дерево из `OrdersModule` (не `PaymentsModule` напрямую) —
 * `PaymentsModule.providers` содержит `OrdersFacadeAdapter implements PaymentsOrdersPort`
 * (канонический, DTJ-242), который инжектит `ORDERS_FACADE` (`@Global()` на `OrdersModule`).
 * `@Global()` делает провайдер видимым ТОЛЬКО модулям, реально присутствующим в СКОМПИЛИРОВАННОМ
 * графе — testing-модуль без `OrdersModule` нигде в дереве не получает `ORDERS_FACADE` вовсе
 * (обнаружено живым прогоном этого файла после приземления DTJ-242). `OrdersModule` уже
 * импортирует `PaymentsModule`/`AuthModule`/`IdempotencyModule`-зависимости транзитивно.
 *
 * ОТЛИЧИЕ от `orders`-harness: ТАМ `installDefaultTenantContextHook` резолвит `TenantContext`
 * ИЗ `claims.tenantId` самого токена — работает, пока актор всегда привязан к тенанту. ЗДЕСЬ
 * `super_admin` (`claims.tenantId === null`, SRS-TEN-010, «межтенантный» по дизайну) обязан
 * уметь читать леджер ЛЮБОГО тенанта — фиксированное автоматическое резолвление из токена не
 * подходит. Хук ниже — ТОЛЬКО гостевой фолбэк (неаутентифицированные запросы, если появятся);
 * для аутентифицированных запросов тесты этого файла ЯВНО оборачивают каждый вызов в
 * `TenantContext.run(...)` (тот же приём, что `cross-tenant-leakage.spec.ts`), указывая РЕЗОЛВЛЕННЫЙ
 * тенант теста, а не тенант из токена.
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
import { DomainEventsModule } from '@/common/events/domain-events.module.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { RequestContext } from '@/common/context/request-context.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'

/** Тестовая (НЕ секрет, Ж13) RSA-пара — идентична `orders`/`auth`-harness'ам. */
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

const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/dorutj_test3',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://:dorutj_dev_redis_password@localhost:6379/2',
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-payments-ledger',
  PAYMENT_PROVIDER_TIMEOUT_MS: '8000',
  PAYMENT_DRIVER: 'mock_bank',
  MOCK_BANK_WEBHOOK_SECRET: 'test-mock-bank-webhook-secret-ledger-spec',
  MOCK_BANK_AUTO_PAY_DELAY_MS: '0',
  // Требуются транзитивно — этот harness грузит `OrdersModule` целиком (см. JSDoc файла), не
  // только `PaymentsModule` — 1:1 с `orders/__tests__/test-app.ts` TEST_ENV.
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: '60',
  OTP_REQUEST_MAX_PER_10MIN: '3',
  OTP_REQUEST_MAX_PER_DAY: '10',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_payments_ledger',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-payments-ledger-spec',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  CART_HOLD_TTL_SECONDS: '900',
}

function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
}

export interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

const GUEST_TENANT_ID = '77777777-7777-4777-8777-777777777777'
const GUEST_SLUG = 'test-payments-ledger-guest'

export async function createTestApp(): Promise<TestApp> {
  applyTestEnv()
  const moduleRef = await Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, IdempotencyModule, DomainEventsModule, OrdersModule],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  const config = app.get(AppConfigService)
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)
  installDefaultRequestContextHook(app)
  installGuestTenantContextHook(app)
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

/** 1:1 с `orders/__tests__/test-app.ts` — `AuthGuard`/`IdempotencyInterceptor` требуют активный скоуп. */
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

/**
 * ТОЛЬКО гостевой фолбэк (см. JSDoc файла) — тесты этого набора для АУТЕНТИФИЦИРОВАННЫХ
 * запросов оборачивают вызов в `TenantContext.run(...)` явно, этот хук их не перекрывает
 * (срабатывает только если `TenantContext.get() === undefined`).
 */
function installGuestTenantContextHook(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance()
  fastify.addHook('onRequest', (_request, _reply, done) => {
    if (TenantContext.get() !== undefined) {
      done()
      return
    }
    const store = TenantContext.forTenant({ tenantId: GUEST_TENANT_ID, slug: GUEST_SLUG, chainId: null, isNeutral: false })
    TenantContext.run(store, done)
  })
}
