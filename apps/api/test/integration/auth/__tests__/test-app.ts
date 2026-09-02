/**
 * `test-app.ts` (EP-01, DTJ-029) — утилита для integration/security-тестов.
 *
 * Поднимает `NestApplication` с `AuthModule` + InMemory адаптерами +
 * `AllExceptionsFilter`. Никаких реальных Postgres/Redis — `InMemory`-режим
 * достаточно для проверки сценариев из DTJ-023/024/025/026 тикетов end-to-end
 * (HTTP → guard → use case → InMemory-репозиторий → ответ).
 *
 * Идемпотентность между тестами: каждый вызов `createTestApp()` создаёт
 * НОВЫЙ `TestingModule` с НОВЫМИ InMemory-репозиториями. Это даёт чистое
 * состояние (SRS-API-022 атомарность не зависит от порядка тестов).
 *
 * `process.env` настройка ДО `Test.createTestingModule` обязательна —
 * Zod-схема в `env.schema.ts` валидирует ENV при первом обращении через
 * `ConfigService`. Если ENV неполный — `ZodError` на старте.
 */
import { type Server } from 'node:http'
import { type INestApplication, VersioningType } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { AppConfigService } from '@/config/app-config.service.js'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { SharedKernelModule } from '@/shared-kernel/shared-kernel.module.js'
import { LoggerModule } from '@/common/logging/logger.module.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/application/ports/jwt-signer.port.js'

/**
 * Тестовая пара RS256 (Ж13, DTJ-022 `Rs256JwtSignerAdapter`). Сгенерирована локально
 * командой `node -e "const{generateKeyPairSync}=require('node:crypto');...` специально
 * для тестового ENV — НЕ секрет, НЕ используется нигде вне `vitest`. Захардкожена (а не
 * генерируется заново на каждый прогон), чтобы токены между тестами/прогонами были
 * воспроизводимы и не плодили недетерминизм (см. комментарий про 3 прогона без флейков
 * ниже). Утечка этого ключа не создаёт риска — им никогда не подписывается ничего вне
 * `NODE_ENV=test`.
 */
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

/**
 * Все ENV, обязательные для bootstrap'а AuthModule. Значения выбраны
 * детерминированными (фиксированные ключи/порты), чтобы прогон тестов
 * был повторяемым (DTJ-029 критерий приёмки 1 — 3 прогона без флейков).
 */
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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  // Ж13: без этих двух тесты падают с "JWT_PRIVATE_KEY is not set" ещё в
  // TestingInjector — Rs256JwtSignerAdapter бросает в конструкторе, весь набор
  // integration-тестов auth (twa-security, otp-*, refresh-*, create-staff-account,
  // cross-tenant-leakage, get-me, phone-tenant-isolation) падал до первого assert.
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1',
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

/**
 * Создаёт изолированный `NestApplication` поверх `AuthModule` + InMemory
 * адаптеров. `supertest(httpServer)` может делать реальные HTTP-запросы
 * против контроллеров auth-зоны.
 */
export async function createTestApp(): Promise<TestApp> {
  applyTestEnv()
  // `SharedKernelModule` (`CLOCK`/`ID_GENERATOR`) и `LoggerModule` (`PINO_LOGGER`) — оба
  // `@Global()`, но это не делает их доступными без явного импорта хотя бы в одном модуле
  // дерева: в проде их один раз импортирует `AppModule`, а этот тестовый harness строит
  // дерево ТОЛЬКО из `AuthModule` (Ж13 — без них `RequestOtpUseCase`/`VerifyOtpUseCase`/
  // `TelegramAuthUseCase` не резолвят `@Inject(CLOCK)`, а `RefreshTokenUseCase` — `PINO_LOGGER`).
  const moduleRef = await Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, AuthModule],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  const config = app.get(AppConfigService)
  // Зеркалит `main.ts` (Ж13): все контроллеры объявлены с `version: '1'`, все спеки этого
  // каталога бьют по `/api/v1/...` — без этих двух вызовов Nest тихо регистрирует маршруты
  // без версии/префикса и супертест получает 404 вместо реального ответа контроллера.
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  // AllExceptionsFilter нужен в main.ts — в тестах регистрируем явно, чтобы
  // НЕ зависеть от `app.useGlobalFilters()` в main.ts.
  app.useGlobalFilters(new AllExceptionsFilter())
  // Снимаем request-timeout для тестов (иначе supertest может зависнуть).
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)
  installDefaultTenantContextHook(app)
  await app.init()
  await (app).getHttpAdapter().getInstance().ready()
  const httpServer = app.getHttpServer()
  return {
    app,
    httpServer,
    close: async (): Promise<void> => {
      await app.close()
    },
  }
}

const NEUTRAL_SLUG = 'test-harness-neutral'
const BEARER_PREFIX = 'Bearer '
/**
 * Нейтральный тенант — НАСТОЯЩАЯ строка в `tenants` с настоящим UUID (см. JSDoc
 * `TenantContextStore` в `tenant-context.ts` и `apps/api/migrations/0021_seed_neutral_tenant.sql`,
 * единственный источник истины). Раньше здесь стоял `tenantId: null` — «резолвинг не
 * произошёл» по контракту `TenantContext`, а НЕ «резолвлен в нейтральный». Это давало
 * `OtpVerifyController.resolveTenantIdForVerify()` пустой `TenantContext` для ЛЮБОГО
 * unauthenticated-запроса (otp/verify всегда идёт без Bearer) → контроллер честно бросал
 * ошибку (CTO-решение: громкое падение вместо мусора в UUID-колонке — правильно), но в
 * ПРОДЕ такой запрос резолвится `TenantResolutionMiddleware` в реальный нейтральный тенант,
 * а не остаётся unresolved. Харнесс обязан воспроизводить это (Ж13), поэтому неаутентифи-
 * цированный fallback теперь возвращает id из миграции, а не `null`.
 */
const NEUTRAL_TENANT_ID = '00000000-0000-4000-8000-000000000001'

/**
 * Этот harness строит дерево ТОЛЬКО из `AuthModule` (Ж13) — без `TenancyModule`/
 * `TenantResolutionMiddleware` (DTJ-054, требует реальные Postgres/Redis через
 * `TENANT_REPOSITORY`/`TENANT_CACHE` — недоступны в изолированном auth-harness).
 * Без РЕЗОЛВЛЕННОГО `TenantContext` `AuthGuard.assertCrossTenantAccess` бросает
 * `401 tenant context not initialized` для ЛЮБОГО актора с нетривиальным
 * `tenantId` в claims — то есть весь happy-path (`pharmacy_admin` создаёт
 * staff, `GET /auth/me` и т.п.) был бы недостижим в этих тестах.
 *
 * Хук — `onRequest`-уровня, ставит `TenantContext.run(...)`, ТОЧНО как это
 * делает `TenantResolutionMiddleware.use()` в проде (`TenantContext.run(store,
 * next)`), только вместо резолва по `Host`/`X-Tenant-Slug` через БД — доверяет
 * `tenantId`/`chainId` ИЗ ТОГО ЖЕ Bearer-токена, который AuthGuard всё равно
 * сейчас будет проверять (запрос «резолвится» в тенант самого актора — ровно
 * то допущение, из которого исходят happy-path сценарии этих security-тестов).
 *
 * Тесты, которым нужен НЕСОВПАДАЮЩИЙ resolved-тенант (например
 * `cross-tenant-leakage.spec.ts`, сценарии 2-4), оборачивают конкретный
 * `supertest`-вызов в свой `TenantContext.run(...)` — `TenantContext.get()`
 * ниже уже увидит их контекст (AsyncLocalStorage переживает границу
 * client→server в рамках одного процесса) и хук НИЧЕГО не переопределяет.
 */
function installDefaultTenantContextHook(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance()
  fastify.addHook('onRequest', (request, _reply, done) => {
    if (TenantContext.get() !== undefined) {
      // Тест уже сам обернул вызов в TenantContext.run(...) — не мешаем.
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
  const neutral = { tenantId: NEUTRAL_TENANT_ID, slug: NEUTRAL_SLUG, chainId: null, isNeutral: true }
  if (typeof authHeader !== 'string' || !authHeader.startsWith(BEARER_PREFIX)) {
    return neutral
  }
  const token = authHeader.slice(BEARER_PREFIX.length)
  const jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  const result = jwtSigner.verify(token)
  if (!result.ok) {
    return neutral
  }
  return {
    tenantId: result.value.tenantId,
    slug: NEUTRAL_SLUG,
    chainId: result.value.chainId,
    isNeutral: result.value.tenantId === null,
  }
}
