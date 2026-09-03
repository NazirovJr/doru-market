/**
 * `test-app.ts` (EP-01, DTJ-029; волна 5 блок A возврат) — утилита для
 * integration/security-тестов.
 *
 * Поднимает `NestApplication` с `AuthModule` — Drizzle/Redis-адаптеры
 * (волна 5, `reports/CTO-DECISION-WAVE5.md` §3) против настоящих
 * `dorutj_test` Postgres и Redis + `AllExceptionsFilter`.
 *
 * Идемпотентность между тестами: раньше (InMemory-адаптеры) её давал сам
 * факт НОВОГО `TestingModule` с НОВЫМИ InMemory-репозиториями на каждый
 * `createTestApp()`. Теперь состояние общее и настоящее (общая `dorutj_test`
 * БД + общий Redis), поэтому `createTestApp()` САМ восстанавливает то же
 * свойство — `resetAuthState()` ниже чистит auth-таблицы и auth-специфичные
 * Redis-ключи ПЕРЕД возвратом `TestApp`. Без этого сквозные security-спеки
 * (`test/integration/auth/**`) делят один Redis rate-limit-бакет с реальным
 * TTL (`OtpRequestController` хардкодит `ipAddress = '0.0.0.0'` для ВСЕХ
 * запросов, EP-19 ещё не даёт реальный IP) и один `otp_codes`/`users` набор
 * строк на общий литерал `PHONE = '+992917123456'`, используемый в 4 файлах
 * — отсюда `429` вместо `202`/`200` независимо от порядка запуска файлов
 * (см. CTO-разбор волны 5 блок A возврат).
 *
 * `process.env` настройка ДО `Test.createTestingModule` обязательна —
 * Zod-схема в `env.schema.ts` валидирует ENV при первом обращении через
 * `ConfigService`. Если ENV неполный — `ZodError` на старте.
 */
import { type Server } from 'node:http'
import { type INestApplication, VersioningType } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import type Redis from 'ioredis'
import type { Pool } from 'pg'
import { AppConfigService } from '@/config/app-config.service.js'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { SharedKernelModule } from '@/shared-kernel/shared-kernel.module.js'
import { LoggerModule } from '@/common/logging/logger.module.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/application/ports/jwt-signer.port.js'
import {
  USER_TELEGRAM_IDENTITIES_REPOSITORY,
  type UserTelegramIdentitiesRepository,
} from '@/modules/auth/application/ports/user-telegram-identities.repository.port.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import { authSessions } from '@/db/schema/auth-sessions.js'
import { userTelegramIdentities } from '@/db/schema/user-telegram-identities.js'
import { otpCodes } from '@/db/schema/otp-codes.js'
import { users } from '@/db/schema/users.js'

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
 * Опции `createTestApp` (волна 6, self-deadlock пула соединений — доказательство
 * атомарности `VerifyOtpUseCase`/`TelegramAuthUseCase` на живом Postgres,
 * `verify-otp-race-conditions.integration.spec.ts`/`telegram-auth-race-conditions.integration.spec.ts`).
 * Единственные намеренные `overrideProvider` этого harness'а — оба нужны РОВНО для
 * rollback-доказательства (форсируют исключение ПОСЛЕДНИМ шагом ВНУТРИ `uow.run(tx =>
 * ...)`, ПЕРЕД commit, чтобы проверить: откат транзакции откатывает ВСЕ вложенные записи):
 *   - `overrideJwtSigner` — подменяет `JWT_SIGNER`; `signAccessToken` в `VerifyOtpUseCase`
 *     вызывается ПОСЛЕДНИМ внутри её `uow.run` (после create user/session/markConsumed).
 *   - `overrideUserTelegramIdentitiesRepository` — подменяет `USER_TELEGRAM_IDENTITIES_REPOSITORY`;
 *     `telegramIdentities.create` в `TelegramAuthUseCase.findOrCreateUser` вызывается
 *     ПОСЛЕДНИМ внутри её `uow.run` (после `users.create`).
 */
export interface CreateTestAppOptions {
  readonly overrideJwtSigner?: JwtSignerPort
  readonly overrideUserTelegramIdentitiesRepository?: UserTelegramIdentitiesRepository
}

/**
 * Создаёт изолированный `NestApplication` поверх `AuthModule` — Drizzle/Redis
 * адаптеры против настоящих `dorutj_test` Postgres/Redis. `supertest(httpServer)`
 * может делать реальные HTTP-запросы против контроллеров auth-зоны.
 *
 * Перед возвратом чистит auth-состояние (`resetAuthState`) — см. JSDoc файла
 * выше: каждый вызов обязан начинать с того же пустого состояния, которое
 * раньше давал НОВЫЙ InMemory-репозиторий.
 */
export async function createTestApp(options?: CreateTestAppOptions): Promise<TestApp> {
  applyTestEnv()
  // `SharedKernelModule` (`CLOCK`/`ID_GENERATOR`) и `LoggerModule` (`PINO_LOGGER`) — оба
  // `@Global()`, но это не делает их доступными без явного импорта хотя бы в одном модуле
  // дерева: в проде их один раз импортирует `AppModule`, а этот тестовый harness строит
  // дерево ТОЛЬКО из `AuthModule` (Ж13 — без них `RequestOtpUseCase`/`VerifyOtpUseCase`/
  // `TelegramAuthUseCase` не резолвят `@Inject(CLOCK)`, а `RefreshTokenUseCase` — `PINO_LOGGER`).
  const builder = Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, AuthModule],
  })
  if (options?.overrideJwtSigner !== undefined) {
    builder.overrideProvider(JWT_SIGNER).useValue(options.overrideJwtSigner)
  }
  if (options?.overrideUserTelegramIdentitiesRepository !== undefined) {
    builder
      .overrideProvider(USER_TELEGRAM_IDENTITIES_REPOSITORY)
      .useValue(options.overrideUserTelegramIdentitiesRepository)
  }
  const moduleRef = await builder.compile()
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
  await resetAuthState(app, config)
  const httpServer = app.getHttpServer()
  return {
    app,
    httpServer,
    close: async (): Promise<void> => {
      // `drizzleProvider`/`redisProvider` (`src/infrastructure/{database,redis}/*.provider.ts`,
      // общая инфраструктура, вне `files_owned` этой задачи) не реализуют
      // `OnModuleDestroy` — `app.close()` не закрывает лежащие в основе `pg.Pool`/`ioredis`.
      // Этот harness строит НОВЫЙ `Test.createTestingModule` (⇒ НОВЫЙ Pool/Redis-клиент) на
      // КАЖДЫЙ тест — без явного закрытия здесь соединения копятся в рамках одного
      // `vitest run`-процесса и на длинных прогонах (весь `test/integration/**`, несколько
      // раз подряд) упираются в `max_connections`. Закрываем то, что открыли МЫ, не трогая
      // сам провайдер (чужой файл, вне границ задачи — см. `foundIssues` отчёта).
      // `$client` — свойство ТОЛЬКО фактического значения, которое возвращает
      // `drizzle(pool)` (пересечение типов в `drizzle-orm/node-postgres/driver.d.ts`),
      // не публичного типа `DrizzleDb = NodePgDatabase` из `drizzle.provider.ts` (тоже
      // не наш файл — трогать его ради типа не входит в задачу). Каст локален
      // к этому файлу и не расширяет продовый контракт `DrizzleDb`.
      const db = app.get<DrizzleDb>(DRIZZLE_DB) as DrizzleDb & { $client: Pool }
      const redis = app.get<Redis>(REDIS_CLIENT)
      await app.close()
      await db.$client.end()
      redis.disconnect()
    },
  }
}

/**
 * [Волна 5, блок A, возврат] Чистит auth-состояние в общей `dorutj_test`
 * Postgres/Redis ПЕРЕД каждым тестом — восстанавливает свойство «каждый
 * `createTestApp()` начинает с чистого листа», которое раньше давал НОВЫЙ
 * `InMemory*`-репозиторий (см. JSDoc файла выше).
 *
 * Postgres: `DELETE` (НЕ `TRUNCATE ... CASCADE`) по auth-таблицам, явно, в
 * порядке потомок→родитель. `TRUNCATE ... CASCADE` от `users` затронул бы
 * ЛЮБУЮ таблицу вне auth с FK на `users(id)` (например,
 * `search_query_log.customer_id`, ON DELETE SET NULL) — она была бы
 * ЦЕЛИКОМ очищена, а не просто отвязана, задев данные каталога/поиска вне
 * границ этой задачи. `DELETE` уважает FK-политику КАЖДОЙ ссылающейся
 * таблицы (`ON DELETE CASCADE`/`SET NULL`) штатно, без этого риска — тот же
 * урок, что и §3.7 `docs/07-WAVE4-HANDOFF.md` («TRUNCATE... CASCADE
 * зацепил больше, чем предполагалось»), только на уровень раньше: здесь мы
 * вообще не трогаем `tenants`/`tenant_settings`.
 *
 * Redis: точечно удаляет ключи ДВУХ известных префиксов rate-limit'а auth
 * (`${otpRateLimitKeyPrefix}:*` из `RequestOtpUseCase.buildRateLimitChecks`,
 * `otp_verify_attempts:*` — литерал `RATE_LIMITER_KEY_PREFIX_VERIFY` в
 * `VerifyOtpUseCase`, порт-приватный, не экспортируется, поэтому продублирован
 * здесь текстом с явной ссылкой на источник). НЕ `FLUSHDB` — тот же Redis
 * используется `test/integration/catalog/{redis-lock-guard,search-cache}.integration.spec.ts`
 * в ОДНОМ прогоне `vitest run --config vitest.integration.config.ts`
 * (`fileParallelism: false`, но каталоги идут последовательно в одном
 * процессе) — полный `FLUSHDB` стёр бы их состояние, что вне границ задачи
 * (правило 7 AGENTS.md).
 *
 * Без этого сброса `OtpRequestController`, вынужденно хардкодящий
 * `ipAddress = '0.0.0.0'` для ВСЕХ запросов (EP-19 ещё не даёт реальный IP),
 * копит ОДИН и тот же `ip1h`-бакет на ВСЕ вызовы `/auth/otp/request` из ВСЕХ
 * 8 auth-security-файлов и из ОБОИХ прогонов подряд (приёмка волны 5 требует
 * именно двух прогонов без пересоздания БД) — `OTP_REQUEST_MAX_PER_IP_PER_HOUR=20`
 * в тест-ENV, а только `/auth/otp/request`-вызовов в сьюте 18 за один прогон.
 */
async function resetAuthState(app: INestApplication, config: AppConfigService): Promise<void> {
  const db = app.get<DrizzleDb>(DRIZZLE_DB)
  await db.delete(authSessions)
  await db.delete(userTelegramIdentities)
  await db.delete(otpCodes)
  await db.delete(users)

  const redis = app.get<Redis>(REDIS_CLIENT)
  const OTP_VERIFY_ATTEMPTS_KEY_PREFIX = 'otp_verify_attempts' // = RATE_LIMITER_KEY_PREFIX_VERIFY в verify-otp.use-case.ts
  await deleteKeysMatching(redis, `${config.otpRateLimitKeyPrefix}:*`)
  await deleteKeysMatching(redis, `${OTP_VERIFY_ATTEMPTS_KEY_PREFIX}:*`)
}

/** `KEYS` — приемлемо в тесте (низкая кардинальность test-namespace'ов), НЕ для прода. */
async function deleteKeysMatching(redis: Redis, pattern: string): Promise<void> {
  const keys = await redis.keys(pattern)
  if (keys.length > 0) {
    await redis.del(...keys)
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
