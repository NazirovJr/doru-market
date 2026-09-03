/**
 * Интеграционный тест `PharmaciesMapController` (DTJ-197, EP-08, R1-6).
 *
 * Реальный HTTP (`supertest` + Fastify) поверх `CatalogModule`, тот же приём, что
 * `categories-controller.integration.spec.ts` (DTJ-094): никакой БД, `PHARMACY_MAP_REPOSITORY`
 * подменяется in-memory фейком. Доказывает Ж2 — маршрут `GET /api/v1/pharmacies/map`
 * реально смонтирован в Nest (не просто написан контроллер) и целиком проходит через
 * реальный DI-граф `CatalogModule` (который импортирует `AuthModule`, см. `catalog.module.ts`).
 *
 * `TenantContext` в проде ставит `TenantResolutionMiddleware` (`tenancy`-модуль, вне
 * `files_owned` этого тикета, править запрещено). Здесь его подменяет собственный
 * тестовый middleware, который делает то же самое (`TenantContext.run`) — легитимное
 * использование ПУБЛИЧНОГО API `TenantContext`, не правка чужого файла.
 *
 * Сценарии (критерии приёмки DTJ-197):
 *   1. Успешный ответ — плоский массив `PharmacyMapPinDto` (без `medicineId`, `offer: null`).
 *   2. Невалидный `bbox` (не 4 числа) → `400 VALIDATION_ERROR`, не 500.
 *   3. Вырожденный `bbox` (`lonMin >= lonMax`) → `400 VALIDATION_ERROR`.
 *   4. `medicineId` не-uuid → `400 VALIDATION_ERROR`.
 *   5. `medicineId`-uuid пробрасывается в use case → репозиторий получает его в query.
 *   6. Слишком большой `bbox` (вся территория Таджикистана, `SRS-CAT-054`) → ошибка
 *      use case (`BboxTooLargeError`) корректно долетает наружу как `400 VALIDATION_ERROR
 *      details.field='bbox'` через глобальный `AllExceptionsFilter`.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-052, SRS-CAT-054, TC-CAT-024)
 */
import type { Server } from 'node:http'
import {
  Injectable,
  Module,
  VersioningType,
  type INestApplication,
  type MiddlewareConsumer,
  type NestMiddleware,
  type NestModule,
} from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppConfigService } from '@/config/app-config.service.js'
import { AppConfigModule } from '@/config/config.module.js'
import { SharedKernelModule } from '@/shared-kernel/shared-kernel.module.js'
import { LoggerModule } from '@/common/logging/logger.module.js'
import { DatabaseModule } from '@/infrastructure/database/database.module.js'
import { RedisModule } from '@/infrastructure/redis/redis.module.js'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { TenantContext, type TenantContextStore } from '@/common/context/tenant-context.js'
import { CatalogModule } from '@/modules/catalog/catalog.module.js'
import {
  PHARMACY_MAP_REPOSITORY,
  type BboxQuery,
  type PharmacyMapPin,
  type PharmacyMapRepository,
} from '@/modules/catalog/application/pharmacies-map/ports/pharmacy-map-repository.port.js'

// Тестовая пара RS256 (Ж13) — идентична паре в `categories-controller.integration.spec.ts`:
// `CatalogModule` импортирует `AuthModule`, который транзитивно инстанцирует
// `Rs256JwtSignerAdapter`, требующий эти ключи, даже когда тест не бьёт по auth-маршрутам.
// Не сгенерирован заново, скопирован из уже существующего тестового файла (не секрет,
// нигде вне vitest не используется) — не дублируем НОВЫЙ ключ ради Ж12/детерминизма.
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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1',
}

function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
}

/** UUID тенанта, под которым идут все запросы этого теста (нейтральный, но реальный UUID). */
const FIXED_TENANT_ID = '11111111-1111-4111-8111-111111111111'
const FIXED_TENANT_STORE: TenantContextStore = {
  tenantId: FIXED_TENANT_ID,
  slug: 'neutral',
  chainId: null,
  isNeutral: true,
  unresolved: false,
  unresolvedReason: null,
}

/**
 * Заменяет `TenantResolutionMiddleware` (файл `tenancy`, вне `files_owned` этого тикета)
 * ТОЛЬКО для этого теста — ставит фиксированный резолвленный `TenantContext` на каждый
 * запрос через тот же публичный API (`TenantContext.run`), которым пользуется реальный
 * middleware. `TenantScopeGuard` (`tenancy`, `APP_GUARD`) сюда НЕ подключаем — этот тест
 * проверяет `PharmaciesMapController`, а не гард резолвинга тенанта (у него своя спека).
 */
@Injectable()
class FixedTenantContextMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: () => void): void {
    TenantContext.run({ ...FIXED_TENANT_STORE }, next)
  }
}

@Module({})
class FixedTenantContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(FixedTenantContextMiddleware).forRoutes('*')
  }
}

/** In-memory фейк `PharmacyMapRepository` — фиксирует последний запрос для ассертов. */
class FakePharmacyMapRepository implements PharmacyMapRepository {
  lastQuery: BboxQuery | undefined
  private readonly pins: readonly PharmacyMapPin[]

  constructor(pins: readonly PharmacyMapPin[]) {
    this.pins = pins
  }

  findPinsInBbox(query: BboxQuery): Promise<readonly PharmacyMapPin[]> {
    this.lastQuery = query
    return Promise.resolve(this.pins)
  }
}

function makePin(overrides: Partial<PharmacyMapPin> = {}): PharmacyMapPin {
  return {
    pharmacyId: '650e8400-e29b-41d4-a716-446655440001',
    name: 'Аптека №1',
    lat: 38.5598,
    lon: 68.787,
    isOpenNow: true,
    is24x7: false,
    offer: null,
    ...overrides,
  }
}

interface TestContext {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly repository: FakePharmacyMapRepository
  readonly close: () => Promise<void>
}

/** Малый bbox (~1 км²) около Душанбе — далеко в пределах `BBOX_MAX_AREA_KM2`. */
const SMALL_BBOX_QUERY = 'bbox=68.78,38.55,68.79,38.56'
/** Весь Таджикистан — площадь far больше `BBOX_MAX_AREA_KM2=2500`, см. use-case спеку DTJ-196. */
const TAJIKISTAN_BBOX_QUERY = 'bbox=67.3,36.6,75.2,41.1'

async function createTestApp(pins: readonly PharmacyMapPin[] = [makePin()]): Promise<TestContext> {
  applyTestEnv()
  const repository = new FakePharmacyMapRepository(pins)
  // Тот же набор `@Global()`-модулей, что и `categories-controller.integration.spec.ts`
  // (`CatalogModule` не импортирует их сама — в проде это делает `AppModule`, единственный
  // раз). `FixedTenantContextModule` — см. JSDoc выше, замена `TenantResolutionMiddleware`.
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      SharedKernelModule,
      LoggerModule,
      DatabaseModule,
      RedisModule,
      FixedTenantContextModule,
      CatalogModule,
    ],
  })
    .overrideProvider(PHARMACY_MAP_REPOSITORY)
    .useValue(repository)
    .compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  // Зеркалит `main.ts` (Ж13): без версии/префикса Nest тихо регистрирует маршрут
  // без `/api/v1`, супертест получит 404 вместо проверки реального контракта.
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  // `BboxTooLargeError` (`ValidationError extends DomainError`) — нужен реальный фильтр,
  // иначе Nest вернёт 500 на непойманное доменное исключение. `AllExceptionsFilter` —
  // единственный фильтр приложения (волна 6): `DomainExceptionFilter` был зарегистрирован
  // рядом, но недостижим, и удалён; маскировка 500 перенесена в этот.
  app.useGlobalFilters(new AllExceptionsFilter())
  const config = app.get(AppConfigService)
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  return {
    app,
    httpServer: app.getHttpServer(),
    repository,
    close: async (): Promise<void> => {
      await app.close()
    },
  }
}

interface ErrorResponseBody {
  readonly error: { readonly code: string; readonly message: string; readonly details?: Record<string, unknown> }
}

describe('GET /api/v1/pharmacies/map (DTJ-197, SRS-CAT-052/054)', () => {
  let ctx: TestContext | undefined

  beforeEach(() => {
    ctx = undefined
  })

  afterEach(async () => {
    if (ctx) await ctx.close()
  })

  it('1. успешный ответ: плоский массив пинов, offer: null без medicineId', async () => {
    ctx = await createTestApp([makePin({ pharmacyId: 'ph-1', isOpenNow: true, is24x7: false })])

    const res = await request(ctx.httpServer).get(`/api/v1/pharmacies/map?${SMALL_BBOX_QUERY}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        pharmacyId: 'ph-1',
        name: 'Аптека №1',
        lat: 38.5598,
        lon: 68.787,
        isOpenNow: true,
        is24x7: false,
        offer: null,
      },
    ])
    // tenantId use case построил из FIXED_TENANT_STORE, не выдуман контроллером.
    expect(ctx.repository.lastQuery?.tenantId.toString()).toBe(FIXED_TENANT_ID)
  })

  it('2. невалидный bbox (не 4 числа) → 400 VALIDATION_ERROR, не 500', async () => {
    ctx = await createTestApp()

    const res = await request(ctx.httpServer).get('/api/v1/pharmacies/map?bbox=1,2,3')

    expect(res.status).toBe(400)
    const body = res.body as ErrorResponseBody
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(ctx.repository.lastQuery).toBeUndefined()
  })

  it('3. вырожденный bbox (lonMin >= lonMax) → 400 VALIDATION_ERROR', async () => {
    ctx = await createTestApp()

    const res = await request(ctx.httpServer).get('/api/v1/pharmacies/map?bbox=68.79,38.55,68.78,38.56')

    expect(res.status).toBe(400)
    const body = res.body as ErrorResponseBody
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('4. medicineId не-uuid → 400 VALIDATION_ERROR', async () => {
    ctx = await createTestApp()

    const res = await request(ctx.httpServer).get(`/api/v1/pharmacies/map?${SMALL_BBOX_QUERY}&medicineId=not-a-uuid`)

    expect(res.status).toBe(400)
    const body = res.body as ErrorResponseBody
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(ctx.repository.lastQuery).toBeUndefined()
  })

  it('5. валидный medicineId пробрасывается в use case → репозиторий получает его в query', async () => {
    const medicineId = '650e8400-e29b-41d4-a716-446655440111'
    ctx = await createTestApp([makePin({ offer: { priceDiram: 1500, stockQuantity: 3, lastSyncedAt: '2026-01-01T00:00:00.000Z', isStale: false } })])

    const res = await request(ctx.httpServer).get(`/api/v1/pharmacies/map?${SMALL_BBOX_QUERY}&medicineId=${medicineId}`)

    expect(res.status).toBe(200)
    expect(ctx.repository.lastQuery?.medicineId).toBe(medicineId)
    expect((res.body as { offer: unknown }[])[0]?.offer).toEqual({
      priceDiram: 1500,
      stockQuantity: 3,
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      isStale: false,
    })
  })

  it('6. bbox покрывает весь Таджикистан (SRS-CAT-054) → 400 VALIDATION_ERROR details.field=bbox, репозиторий не вызван', async () => {
    ctx = await createTestApp()

    const res = await request(ctx.httpServer).get(`/api/v1/pharmacies/map?${TAJIKISTAN_BBOX_QUERY}`)

    expect(res.status).toBe(400)
    const body = res.body as ErrorResponseBody
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details?.field).toBe('bbox')
    // Use case проверяет площадь ДО обращения к репозиторию (SRS-CAT-054) — критерий 4.
    expect(ctx.repository.lastQuery).toBeUndefined()
  })
})
