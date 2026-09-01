/**
 * Интеграционный тест `CategoriesController` (DTJ-094, EP-04 / Волна 4).
 *
 * Контракт проверяется через реальный HTTP (`supertest` + Fastify),
 * `NestApplication` поверх `CatalogModule` + InMemory-репозиторий с заранее
 * подготовленным сидом. Никакой БД (миграция категорий DTJ-091 ещё не имеет
 * seed-runner'а в `apps/api/test/`), замена репозитория — стандартный приём
 * для integration-тестов R1 (см. `apps/api/test/integration/auth/test-app.ts`).
 *
 * Сценарии (по критериям приёмки DTJ-094):
 *   1. `GET /api/v1/categories` → 200, вложенная структура (не плоский список),
 *      корни `parentId: null`, поля `name.{tj,ru,en}` и `childrenCount` есть.
 *   2. `isActive=false` на одном узле → эта категория И все её потомки
 *      отсутствуют в ответе.
 *   3. Дерево глубже `CATEGORY_MAX_DEPTH` (искусственно 5 уровней) → 200,
 *      полное дерево возвращается (НЕ 500, критерий 3 приёмки).
 *
 * @see docs/tickets/ep03-catalog-analogs/DTJ-094.md
 * @see docs/STATE-AND-RESUME-POINT.md §11.6 (Волна 4)
 */
import type { Server } from 'node:http'
import { VersioningType, type INestApplication } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { AppConfigService } from '@/config/app-config.service.js'
import { CatalogModule } from '@/modules/catalog/catalog.module.js'
import { CATEGORIES_READ_REPOSITORY } from '@/modules/catalog/application/ports/categories-read.repository.port.js'
import type { CategoryRecord } from '@/modules/catalog/application/ports/categories-read.repository.port.js'
import { SharedKernelModule } from '@/shared-kernel/shared-kernel.module.js'
import { LoggerModule } from '@/common/logging/logger.module.js'
import { DatabaseModule } from '@/infrastructure/database/database.module.js'
// DTJ-187: CatalogModule теперь также содержит SearchCacheService/RedisLockGuard
// (Redis-кэш поиска), поэтому по той же причине, что и DatabaseModule выше (@Global()
// не резолвит без явного импорта в изолированном TestingModule), нужен RedisModule.
import { RedisModule } from '@/infrastructure/redis/redis.module.js'
import { AppConfigModule } from '@/config/config.module.js'

/**
 * Контролируемый in-memory репозиторий, через который мы подсовываем сид
 * в `NestApplication`. Каждый вызов `createTestAppWithCategories()` создаёт
 * НОВЫЙ экземпляр (а не делит между тестами) — паттерн из `auth/test-app.ts`.
 */
class SeededCategoriesReadRepository {
  private readonly rows: readonly CategoryRecord[]

  constructor(seed: readonly CategoryRecord[]) {
    // Глубокая копия, чтобы тест не зависел от мутаций вне экземпляра.
    this.rows = seed.map((row) => ({ ...row }))
  }

  listAll(): Promise<readonly CategoryRecord[]> {
    return Promise.resolve(this.rows)
  }
}

interface TestContext {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

/**
 * Минимальный ENV для bootstrap'а `AppConfigService`. Значения выбраны
 * детерминированными (фиксированные порты/ключи), чтобы прогон был повторяемым.
 * Идентичен набору из `apps/api/test/integration/auth/test-app.ts` — не импортируем
 * его, чтобы не зависеть от чужого файла вне `files_owned` этого тикета.
 */
// Тестовая пара RS256 (Ж13, DTJ-022 `Rs256JwtSignerAdapter`) — идентична паре в
// `auth/test-app.ts` (см. её комментарий: сгенерирована локально, НЕ секрет,
// НЕ используется нигде вне `vitest`). Дублируется здесь по той же причине,
// что и весь остальной `TEST_ENV` этого файла — files_owned изоляция.
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
  // Ж13: `CatalogModule` импортирует `AuthModule` (см. `catalog.module.ts` —
  // без этого Nest не резолвит гварды каталога), а значит транзитивно
  // инстанцирует `Rs256JwtSignerAdapter`, которому нужны эти два ключа —
  // даже при том, что ни один тест в этом файле не бьёт по auth-маршрутам.
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1',
}

function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
}

/**
 * Поднимает минимальный `NestApplication` с `CatalogModule` + переопределённым
 * `CATEGORIES_READ_REPOSITORY`. Тот же ENV, что в `auth/test-app.ts` — иначе
 * `AppConfigService` упадёт на Zod-валидации.
 */
async function createTestAppWithCategories(
  seed: readonly CategoryRecord[],
): Promise<TestContext> {
  applyTestEnv()
  // `SharedKernelModule` (`CLOCK`/`ID_GENERATOR`) и `LoggerModule` (`PINO_LOGGER`) —
  // оба `@Global()`, но `CatalogModule` (транзитивно через `AuthModule`, которую
  // сама импортирует) использует их провайдеров, а НИ CatalogModule, НИ AuthModule
  // не импортируют их сами (в проде это делает `AppModule`, единственный раз —
  // см. `auth/test-app.ts`, тот же приём).
  // `CatalogModule` регистрирует несколько Drizzle-адаптеров безусловно
  // (`CatalogRepositoryAdapter`, `FuzzyMedicineMatcherAdapter`, `AnalogCandidatesAdapter`,
  // ...) — Nest инстанцирует их все при бутстрапе модуля, даже если тест
  // вызывает только `CATEGORIES_READ_REPOSITORY` (эндпоинт категорий). Ни
  // один из них не импортирует `DatabaseModule` сам (в проде это делает
  // `AppModule`, единственный раз, `@Global()`), поэтому DI не резолвит
  // `DRIZZLE_DB` без явного импорта здесь. `pg.Pool` не подключается лениво
  // в конструкторе — методы Drizzle-репозиториев этот тест не вызывает,
  // только конструкторы (которые лишь сохраняют ссылку на клиент).
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, SharedKernelModule, LoggerModule, DatabaseModule, RedisModule, CatalogModule],
  })
    .overrideProvider(CATEGORIES_READ_REPOSITORY)
    .useFactory({ factory: (): SeededCategoriesReadRepository => new SeededCategoriesReadRepository(seed) })
    .compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  // Зеркалит `main.ts` (Ж13): `CategoriesController` объявлен с `version: '1'`,
  // тест бьёт по `/api/v1/categories` — без этих двух вызовов Nest тихо
  // регистрирует маршрут без версии/префикса и супертест получает 404.
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  // DomainExceptionFilter не нужен (контроллер не бросает доменные ошибки),
  // но AllExceptionsFilter — на случай непредвиденных 500-х.
  app.useGlobalFilters(new AllExceptionsFilter())
  const config = app.get(AppConfigService)
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  return {
    app,
    httpServer: app.getHttpServer(),
    close: async (): Promise<void> => {
      await app.close()
    },
  }
}

function makeRecord(overrides: Partial<CategoryRecord>): CategoryRecord {
  return {
    id: 0,
    parentId: null,
    slug: 'slug',
    nameTj: 'тадж',
    nameRu: 'рус',
    nameEn: 'en',
    commissionCategory: 'otc',
    sortOrder: 0,
    isActive: true,
    ...overrides,
  }
}

/**
 * Контракт ответа `GET /api/v1/categories`: `{ data: CategoryDto[] }` (SRS-API-014).
 * Тело ВСЕГДА обёрнуто в `{ data }` — без `ResponseInterceptor` (он не подключён
 * в test-app, см. `apps/api/src/main.ts`). Хелпер ниже извлекает массив узлов
 * с правильной типизацией (без приведения к `unknown` и `Array.isArray` — это
 * анти-паттерн для TS, см. review-комментарии).
 */
interface CategoryNodeBody {
  readonly id: number
  readonly parentId: number | null
  readonly slug: string
  readonly name: { readonly tj: string; readonly ru: string; readonly en: string }
  readonly sortOrder: number
  readonly childrenCount: number
  readonly children: readonly CategoryNodeBody[]
}
interface CategoriesResponseBody {
  readonly data: readonly CategoryNodeBody[]
}

function extractData(res: { readonly body: unknown }): readonly CategoryNodeBody[] {
  const body = res.body as CategoriesResponseBody
  return body.data
}

describe('GET /api/v1/categories (DTJ-094, SRS-CAT-002/004)', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    if (ctx) await ctx.close()
  })

  beforeEach(() => {
    ctx = undefined
  })

  it('1. happy path: 3-уровневое дерево → 200, вложенная структура, корни parentId=null', async () => {
    const seed: CategoryRecord[] = [
      makeRecord({ id: 1, parentId: null, slug: 'root-1' }),
      makeRecord({ id: 2, parentId: null, slug: 'root-2' }),
      makeRecord({ id: 11, parentId: 1, slug: 'r1-c1' }),
      makeRecord({ id: 12, parentId: 1, slug: 'r1-c2' }),
      makeRecord({ id: 21, parentId: 2, slug: 'r2-c1' }),
      makeRecord({ id: 111, parentId: 11, slug: 'r1-c1-l1', nameTj: 'лист1' }),
      makeRecord({ id: 121, parentId: 12, slug: 'r1-c2-l1', nameTj: 'лист2' }),
      makeRecord({ id: 211, parentId: 21, slug: 'r2-c1-l1', nameTj: 'лист3' }),
    ]
    ctx = await createTestAppWithCategories(seed)

    const res = await request(ctx.httpServer).get('/api/v1/categories')
    expect(res.status).toBe(200)
    const data = extractData(res)
    expect(data).toHaveLength(2)
    for (const root of data) {
      expect(root.parentId).toBeNull()
      expect(root).toHaveProperty('id')
      expect(root).toHaveProperty('slug')
      expect(root).toHaveProperty('name')
      expect(root.name.tj).toBeTruthy()
      expect(root.name.ru).toBeTruthy()
      expect(root.name.en).toBeTruthy()
      expect(root).toHaveProperty('sortOrder')
      expect(root).toHaveProperty('childrenCount')
    }
    const root1 = data[0]
    expect(root1).toBeDefined()
    expect(root1?.id).toBe(1)
    expect(root1?.childrenCount).toBe(2)
  })

  it('2. isActive=false → узел И все потомки отсутствуют (критерий 2 приёмки)', async () => {
    const seed: CategoryRecord[] = [
      makeRecord({ id: 1, parentId: null, slug: 'root' }),
      makeRecord({ id: 2, parentId: 1, slug: 'visible-mid' }),
      makeRecord({ id: 3, parentId: 2, slug: 'visible-leaf' }),
      makeRecord({ id: 4, parentId: 1, slug: 'inactive-mid', isActive: false }),
      makeRecord({ id: 5, parentId: 4, slug: 'inactive-leaf' }),
    ]
    ctx = await createTestAppWithCategories(seed)

    const res = await request(ctx.httpServer).get('/api/v1/categories')
    expect(res.status).toBe(200)
    const data = extractData(res)
    expect(data).toHaveLength(1)
    const root = data[0]
    expect(root).toBeDefined()
    if (!root) return
    const childIds = root.children.map((c) => c.id)
    expect(childIds).toContain(2)
    expect(childIds).not.toContain(4)
    // Дополнительная проверка: id=5 (потомок неактивного) тоже отсутствует.
    const allIds = new Set<number>()
    const walk = (n: CategoryNodeBody): void => {
      allIds.add(n.id)
      for (const c of n.children) walk(c)
    }
    for (const r of data) walk(r)
    expect(allIds.has(5)).toBe(false)
  })

  it('3. глубина > CATEGORY_MAX_DEPTH → 200 + полное дерево (НЕ 500, критерий 3 приёмки)', async () => {
    // Цепочка из 5 уровней — превышает CATEGORY_MAX_DEPTH=3.
    const seed: CategoryRecord[] = [
      makeRecord({ id: 1, parentId: null, slug: 'l1' }),
      makeRecord({ id: 2, parentId: 1, slug: 'l2' }),
      makeRecord({ id: 3, parentId: 2, slug: 'l3' }),
      makeRecord({ id: 4, parentId: 3, slug: 'l4' }),
      makeRecord({ id: 5, parentId: 4, slug: 'l5' }),
    ]
    ctx = await createTestAppWithCategories(seed)

    const res = await request(ctx.httpServer).get('/api/v1/categories')
    expect(res.status).toBe(200)
    const data = extractData(res)
    expect(data).toHaveLength(1)
    const root = data[0]
    expect(root).toBeDefined()
    if (!root) return
    // Вся цепочка видна — деградация без падения.
    const idsSeen: number[] = []
    let current: CategoryNodeBody | undefined = root
    for (let i = 0; i < 6; i++) {
      if (current === undefined) break
      idsSeen.push(current.id)
      current = current.children[0]
    }
    expect(idsSeen).toEqual([1, 2, 3, 4, 5])
  })

  it('4. пустой каталог → 200, data: []', async () => {
    ctx = await createTestAppWithCategories([])

    const res = await request(ctx.httpServer).get('/api/v1/categories')
    expect(res.status).toBe(200)
    expect(extractData(res)).toEqual([])
  })
})