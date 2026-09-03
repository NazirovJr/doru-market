/**
 * `test-app.ts` (EP-09, DTJ-226) — utility для Supertest-интеграции `CartController` против
 * НАСТОЯЩИХ Postgres/Redis (урок волны 5 §6.4 `reports/EP09-CTO-BRIEF.md` — интеграционный
 * тест обязан бить в реальную БД, подмена репозитория фейком запрещена). Тот же приём, что
 * `test/integration/auth/__tests__/test-app.ts` (DTJ-029): `Test.createTestingModule` строит
 * дерево ТОЛЬКО из `OrdersModule` (+ его собственные `imports`: `CatalogModule`,
 * `OnboardingModule`, `AuthModule` — уже подтягивают `DatabaseModule`/`RedisModule`/
 * `AppConfigModule` как `@Global()`), а не из полного `AppModule` (`TenancyModule` целиком не
 * нужна — см. `installDefaultTenantContextHook` ниже, тот же трюк, что у auth-harness).
 *
 * `installDefaultTenantContextHook` — НЕ поднимает реальный `TenantResolutionMiddleware`
 * (потребовал бы заводить настоящий Host/custom-domain тенант для КАЖДОГО теста). Вместо
 * этого: аутентифицированный запрос (`Authorization: Bearer`) резолвит `TenantContext` ИЗ
 * `claims.tenantId` самого токена (тот же трюк, что auth-harness'а `resolveFromBearerClaims`)
 * — `CartIdentityGuard.assertCrossTenantAccess` тогда тривиально совпадает для валидных
 * тестовых токенов; гостевой запрос (без `Authorization`) резолвит В ФИКСИРОВАННЫЙ
 * `GUEST_TENANT_ID`, который тесты обязаны заранее посеять строкой `tenants` (`seedTenant`
 * тестового файла) — иначе `cart.tenant_id` FK не даст вставить строку.
 *
 * `installDefaultRequestContextHook` (ДОБАВЛЕНО DTJ-233) — та же логика, что
 * `installDefaultTenantContextHook` выше, только для `RequestContext` (`common/context/
 * request-context.ts`), а не `TenantContext`: этот harness НЕ поднимает `AppModule`, значит
 * `RequestContextMiddleware` (единственное место, которое в проде вызывает `RequestContext.run()`)
 * никогда не выполняется — до этой правки `RequestContext.get()` был `undefined` на протяжении
 * ВСЕГО запроса. `AuthGuard.canActivate()` (DTJ-233, foundIssue) теперь пишет `userId`/`role` через
 * `RequestContext.patch(...)` ПОСЛЕ верификации JWT — без активного `.run()`-скоупа `patch()` молча
 * no-op'ает (см. её JSDoc), и первый реальный потребитель этого поля,
 * `IdempotencyInterceptor.readUserId()` (фолбэк на `RequestContext.userId`, когда `req.user` не
 * заполнен — а `req.user` не заполняет вообще никто в проекте), получал `undefined` и ронял ЛЮБОЙ
 * аутентифицированный `@Idempotent()`-запрос `401 UNAUTHENTICATED` — воспроизведено живым прогоном
 * `CheckoutController` (DTJ-233, первый контроллер, комбинирующий `AuthGuard` + `@Idempotent()`).
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
import { TenantContext } from '@/common/context/tenant-context.js'
import { RequestContext } from '@/common/context/request-context.js'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'

/** Идентична паре `test/integration/auth/__tests__/test-app.ts` — тестовые ключи, НЕ секрет
 *  (не используется нигде вне `NODE_ENV=test`, Ж13). */
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
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379/0',
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: '60',
  OTP_REQUEST_MAX_PER_10MIN: '3',
  OTP_REQUEST_MAX_PER_DAY: '10',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_orders',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-orders',
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

/** Гостевые (без `Authorization`) запросы резолвят `TenantContext` в ЭТОТ id — тестовый файл
 *  обязан посеять реальную строку `tenants` с этим `id` (FK `cart.tenant_id`). */
export const GUEST_TENANT_ID = '77777777-7777-4777-8777-777777777777'
const GUEST_SLUG = 'test-orders-guest'
const BEARER_PREFIX = 'Bearer '

export interface CreateTestAppOptions {
  /**
   * DTJ-241 — foundIssue (DTJ-238, вне периметра владения этим файлом, НЕ чинится здесь):
   * `MockBankProvider.enqueueWebhookJob` (`payments/infrastructure/adapters/mock-bank.
   * provider.ts`) строит BullMQ `jobId` как `${providerRef}:${type}`, а РЕАЛЬНЫЙ BullMQ
   * отклоняет `jobId`, содержащий `:` («Custom Id cannot contain :») — падает КАЖДЫЙ
   * `createInvoice()` с ненулевым `MOCK_BANK_AUTO_PAY_DELAY_MS` против настоящего Redis.
   * Существующий `mock-bank.provider.integration.spec.ts` не ловит это — там `Queue`
   * замокан (`{ add: vi.fn() }`), не реальный BullMQ. `ENV`-обход (`MOCK_BANK_AUTO_PAY_
   * DELAY_MS=0`) НЕ работает надёжно в этом harness: `AppConfigModule`'s `ConfigModule.
   * forRoot({ cache: true })` — часть СТАТИЧЕСКОЙ метаданных декоратора `@Module(...)`,
   * вычисляется ОДИН раз при первом импорте `config.module.ts` в процессе (`pool: forks` +
   * `fileParallelism: false` — все файлы этого пакета делят один форк) и не видит
   * ENV-мутации последующих файлов. Даёт DI-подмену `MOCK_BANK_AUTO_PAY_QUEUE` фейковой
   * очередью — надёжный обход НА УРОВНЕ DI, не полагающийся на порядок файлов/кэш конфига.
   */
  readonly fakeMockBankAutoPayQueue?: boolean

  /**
   * DTJ-241 — DoD «сквозной тест совместимости порта orders ↔ payments»: `TenancyFacadeAdapter.
   * getEnabledPaymentMethods()` — константа `['cash_courier']` (R1-дефолт, `tenancy-facade.
   * adapter.ts`, НЕ читает БД) — единственный способ провести РЕАЛЬНЫЙ non-cash checkout через
   * `CheckoutUseCase` в тесте — подменить `TENANCY_FACADE_PORT` целиком (тот же порт несёт
   * `resolveCommissionRate`/`getCodLimitDiram` — оставлены делегирующими реальному адаптеру
   * через `useFactory`, чтобы тест не расходился с реальной покатегорийной комиссией).
   */
  readonly enabledPaymentMethods?: readonly string[]
}

export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  applyTestEnv()
  const builder = Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, IdempotencyModule, OrdersModule],
  })
  if (options.fakeMockBankAutoPayQueue === true) {
    const { MOCK_BANK_AUTO_PAY_QUEUE } = await import('@/modules/payments/infrastructure/adapters/mock-bank.provider.js')
    // `close()` — вызывается `PaymentsModule.onModuleDestroy()` при `app.close()`.
    builder.overrideProvider(MOCK_BANK_AUTO_PAY_QUEUE).useValue({ add: () => Promise.resolve(undefined), close: () => Promise.resolve(undefined) })
  }
  if (options.enabledPaymentMethods !== undefined) {
    const { TENANCY_FACADE_PORT } = await import('@/modules/orders/application/ports/tenancy-facade.port.js')
    const { TenancyFacadeAdapter } = await import('@/modules/orders/infrastructure/adapters/tenancy-facade.adapter.js')
    const { TENANT_SETTINGS_REPOSITORY } = await import('@/modules/tenancy/index.js')
    builder.overrideProvider(TENANCY_FACADE_PORT).useFactory({
      factory: (tenantSettingsRepository: unknown) => {
        const real = new TenancyFacadeAdapter(tenantSettingsRepository as ConstructorParameters<typeof TenancyFacadeAdapter>[0])
        return {
          resolveCommissionRate: real.resolveCommissionRate.bind(real),
          getCodLimitDiram: real.getCodLimitDiram.bind(real),
          getEnabledPaymentMethods: () => Promise.resolve(options.enabledPaymentMethods),
        }
      },
      inject: [TENANT_SETTINGS_REPOSITORY],
    })
  }
  const moduleRef = await builder.compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  const config = app.get(AppConfigService)
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)
  installDefaultRequestContextHook(app)
  installDefaultTenantContextHook(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  const httpServer = app.getHttpServer()
  return {
    app,
    httpServer,
    close: async (): Promise<void> => {
      // Тот же приём, что auth-harness — `drizzleProvider`/`redisProvider` не реализуют
      // `OnModuleDestroy`, закрываем то, что открыли мы (см. JSDoc auth test-app.ts).
      const db = app.get<DrizzleDb>(DRIZZLE_DB) as DrizzleDb & { $client: Pool }
      const redis = app.get<Redis>(REDIS_CLIENT)
      await app.close()
      await db.$client.end()
      redis.disconnect()
    },
  }
}

/** См. JSDoc файла «installDefaultRequestContextHook (ДОБАВЛЕНО DTJ-233)» — регистрируется
 *  ПЕРВЫМ (до tenant-хука), чтобы весь остальной запрос (включая `AuthGuard`/`IdempotencyInterceptor`)
 *  выполнялся внутри активного `RequestContext.run()`-скоупа AsyncLocalStorage. */
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

function installDefaultTenantContextHook(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance()
  fastify.addHook('onRequest', (request, _reply, done) => {
    if (TenantContext.get() !== undefined) {
      done()
      return
    }
    const store = TenantContext.forTenant(resolveFromBearerClaims(app, request.headers.authorization))
    TenantContext.run(store, done)
  })
}

function resolveFromBearerClaims(
  app: NestFastifyApplication,
  authHeader: string | undefined,
): { tenantId: string | null; slug: string; chainId: string | null; isNeutral: boolean } {
  const guest = { tenantId: GUEST_TENANT_ID, slug: GUEST_SLUG, chainId: null, isNeutral: false }
  if (typeof authHeader !== 'string' || !authHeader.startsWith(BEARER_PREFIX)) {
    return guest
  }
  const token = authHeader.slice(BEARER_PREFIX.length)
  const jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  const result = jwtSigner.verify(token)
  if (!result.ok) {
    return guest
  }
  return {
    tenantId: result.value.tenantId,
    slug: GUEST_SLUG,
    chainId: result.value.chainId,
    isNeutral: result.value.tenantId === null,
  }
}
