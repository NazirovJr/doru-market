/**
 * Точка входа `apps/api` (DTJ-001, шаг 2) — единственный входной HTTP-процесс продукта.
 * NestJS + Fastify, `@fastify/helmet`/`@fastify/cors` (SRS-API-064/065), лимит тела и
 * таймаут соединения (SRS-API-066/067). Zod-валидация ENV (`config/env.schema.ts`)
 * происходит внутри `NestFactory.create` — до открытия порта (критерий приёмки №4).
 *
 * Глобальный `ValidationPipe` НЕ регистрируется: валидация DTO — Zod в `packages/contracts`,
 * заводится вместе с первыми контроллерами следующих эпиков, не `class-validator`.
 */
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { VersioningType } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import pino from 'pino'
import { AppModule } from './app.module.js'
import { AppConfigService } from './config/app-config.service.js'
import { isAllowedCorsOrigin } from './config/cors-origin.policy.js'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js'

/**
 * `@fastify/helmet`/`@fastify/cors` резолвятся в свою (более новую) копию `fastify`,
 * структурно несовместимую с `FastifyInstance`, против которой типизирован
 * `@nestjs/platform-fastify` (см. `pnpm why fastify` — две версии в дереве: корректный
 * фикс — единый резолв через `overrides` в `pnpm-workspace.yaml`, файл вне `files_owned`
 * этого тикета, см. `assumptions` DTJ-001). Плагины на этой строке рантайм-совместимы
 * (тот же протокол Fastify-плагина), поэтому сужение типа — намеренное и точечное.
 */
type FastifyRegisterablePlugin = Parameters<NestFastifyApplication['register']>[0]

/** SRS-API-066: лимит тела JSON по умолчанию (переопределения для конкретных маршрутов —
 * в тикетах, которым они нужны, например `/inventory/batch-update`, EP-05). */
const DEFAULT_JSON_BODY_LIMIT_BYTES = 1_048_576
/** SRS-API-064: HSTS на год, включая поддомены. */
const HSTS_MAX_AGE_SECONDS = 31_536_000
const LISTEN_HOST = '0.0.0.0'
/** Ненулевой код завершения при фатальной ошибке старта (критерий приёмки №4). */
const STARTUP_FAILURE_EXIT_CODE = 1
/**
 * Глобальный префикс `api` + URI-версионирование (`enableVersioning`) — контроллеры
 * бизнес-модулей объявлены как `@Controller({ path: '...', version: '1' })`
 * (docstring каждого фиксирует маршрут как `/api/v1/...`, см. `docs/00-PROJECT-CHARTER.md`
 * и §19 хендбука: `curl http://localhost:3000/api/v1/medicines`), но без этих двух вызовов
 * NestJS ТИХО игнорирует опцию `version` и регистрирует маршрут без версии и без префикса
 * (`/auth/telegram` вместо `/api/v1/auth/telegram`) — обнаружено при прогоне
 * integration-тестов auth (все они бьют по `/api/v1/...` и получали 404). `health`/`ready`
 * (DTJ-001 §6) намеренно исключены из префикса — они и раньше жили на `/health`/`/ready`,
 * см. §8/§19 хендбука и `HealthController`.
 */
const GLOBAL_API_PREFIX = 'api'
const UNPREFIXED_PATHS = ['health', 'ready']

async function registerTransportSecurity(
  app: NestFastifyApplication,
  config: AppConfigService,
): Promise<void> {
  await app.register(helmet as unknown as FastifyRegisterablePlugin, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
    hsts: { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true },
  })
  await app.register(cors as unknown as FastifyRegisterablePlugin, {
    origin: (origin: string | undefined, callback: (error: Error | null, allow: boolean) => void) => {
      callback(null, origin === undefined || isAllowedCorsOrigin(origin, config))
    },
  })
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: DEFAULT_JSON_BODY_LIMIT_BYTES }),
    // `rawBody: true` (DTJ-242, `PaymentsWebhookController`) — Nest/Fastify сохраняет СЫРЫЕ
    // байты тела запроса в `request.rawBody` ДО JSON-парсинга, не заменяя обычный `req.body`
    // ни для одного другого маршрута (аддитивный флаг, см. риски тикета DTJ-242: HMAC-подпись
    // банковского вебхука покрывает байты, как они пришли по проводу — `JSON.stringify(req.body)`
    // НЕ те же байты, подпись не совпадёт с реальным банком).
    { bufferLogs: true, rawBody: true },
  )
  const config = app.get(AppConfigService)

  app.setGlobalPrefix(GLOBAL_API_PREFIX, { exclude: UNPREFIXED_PATHS })
  app.enableVersioning({ type: VersioningType.URI })

  // SRS-API-067 (`REQUEST_TIMEOUT_MS`): значение известно только ПОСЛЕ валидации ENV
  // внутри `NestFactory.create`, поэтому применяется к уже созданному Fastify-серверу —
  // эквивалентно опции `connectionTimeout` конструктора адаптера (та же настройка Node
  // `http.Server`), просто применённой на шаг позже.
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)

  await registerTransportSecurity(app, config)
  // [DTJ-029] Глобальный фильтр: `DomainError` → `ErrorEnvelope` по `ERROR_HTTP_STATUS`.
  // Без него контроллеры auth-зоны (которые делают `throw result.error`) возвращают
  // 500 Internal Server Error вместо 4xx с машинным кодом ошибки. Регистрация
  // через `useGlobalFilters` (не APP_FILTER provider) — фильтр stateless и не
  // зависит от других провайдеров.
  app.useGlobalFilters(new AllExceptionsFilter())
  app.enableShutdownHooks()

  await app.listen(config.port, LISTEN_HOST)
}

bootstrap().catch((error: unknown) => {
  const fallbackLogger = pino({ name: 'apps-api-bootstrap' })
  fallbackLogger.fatal({ err: error }, 'apps/api failed to start before opening the port')
  process.exit(STARTUP_FAILURE_EXIT_CODE)
})
