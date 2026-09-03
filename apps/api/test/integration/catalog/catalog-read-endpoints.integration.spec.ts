/**
 * Интеграционный тест `MEDICINE_READ_REPOSITORY`/`CATEGORIES_READ_REPOSITORY` — РЕАЛЬНЫЙ
 * Postgres, РЕАЛЬНЫЕ адаптеры (DTJ-092/094 follow-up, Волна 5 блок B).
 *
 * **Почему этот файл существует (прямое указание CTO, см. `reports/CTO-DECISION-WAVE5.md`
 * §3 блок B).** `categories-controller.integration.spec.ts` (DTJ-094) подменяет
 * `CATEGORIES_READ_REPOSITORY` in-memory фейком (`SeededCategoriesReadRepository`, см. её
 * собственный JSDoc: «никакой БД») — ни один существующий тест не бил `GET /api/v1/categories`
 * через `NestApplication` в НАСТОЯЩИЙ Postgres. Это тот же класс дефекта, что скрыл сломанную
 * карту аптек в волне 4 (`docs/07-WAVE4-HANDOFF.md` §3.2): «интеграционный» тест подменял
 * репозиторий и не увидел, что маршрут в проде читает пустой `InMemory*`.
 *
 * **Часть 1 — `GET /api/v1/categories` (HTTP, реальный `NestApplication`, БЕЗ единого
 * `overrideProvider`).** `DatabaseModule` даёт настоящий `DRIZZLE_DB`,
 * `PostgresCategoriesReadRepository` резолвится как есть в проде.
 *
 * **Часть 2 — `PostgresMedicineReadRepository` напрямую (НЕ через HTTP).** `GET
 * /api/v1/medicines` тем же способом (HTTP end-to-end) написать НЕ удалось — см.
 * DEFECT-FOUND ниже, чужой код вне блока B, в `foundIssues` отчёта сдачи, не исправлен здесь.
 * Эта часть НЕ подменяет репозиторий фейком (запрет CTO соблюдён дословно): используется
 * РЕАЛЬНЫЙ `PostgresMedicineReadRepository` с РЕАЛЬНЫМ `DRIZZLE_DB` на том же Postgres —
 * тот же приём, что уже принят `catalog-repository.adapter.integration.spec.ts` (DTJ-092,
 * адаптер-уровень, не HTTP), а не in-memory мок.
 *
 * **DEFECT-FOUND (чужой код, DTJ-095, вне блока B, НЕ исправлен здесь — см. `foundIssues`
 * отчёта сдачи).** `MedicinesController` (`presentation/controllers/medicines.controller.ts`)
 * объявляет `constructor(getMedicineDetail: GetMedicineDetailUseCase, listMedicines:
 * ListMedicinesUseCase)` БЕЗ `@Inject(...)` на обоих параметрах — единственный контроллер
 * `catalog`, где это упущено (`CategoriesController`/`PharmaciesMapController`/
 * `CatalogSearchController` делают это правильно). Под vitest (esbuild, ТОТ ЖЕ класс
 * дефекта, что DTJ-001/`tests/arch/di-explicit-inject.spec.ts`) `design:paramtypes` не
 * эмитится, Nest создаёт контроллер БЕЗ аргументов, оба поля — `undefined`, и любой вызов
 * `GET /api/v1/medicines`/`GET /api/v1/medicines/:id` через `NestApplication`, собранный
 * ИЗ ИСХОДНИКОВ (vitest), падает `TypeError: Cannot read properties of undefined (reading
 * 'execute')`. Гейт `di-explicit-inject.spec.ts` это НЕ ловит: его regex ищет `class`
 * СРАЗУ после `@Controller(...)`, а между ними стоит `@Public()` — та же ситуация у ВСЕХ
 * четырёх контроллеров `catalog`, но только `MedicinesController` реально пропустил
 * `@Inject`. Под `tsc` (боевой `dist/main.js`) `design:paramtypes` эмитится корректно
 * (конкретные типы классов, не `Array`), Nest резолвит оба параметра по классу без
 * `@Inject` штатно — маршрут РАБОТАЕТ в проде (проверено вручную: `pnpm build` + `node
 * dist/main.js` против `dorutj_test` + `curl`, см. отчёт сдачи, «фактический вывод команд»).
 * Это ЕЩЁ ОДНО расхождение esbuild/tsc (см. `docs/07-WAVE4-HANDOFF.md` §3.1), но НЕ
 * блокирует приёмку блока B: `MEDICINE_READ_REPOSITORY`/`ListMedicinesUseCase` (часть 2
 * ниже) читают Postgres корректно независимо от presentation-слоя.
 *
 * **Изоляция от соседних файлов.** `dorutj_test` делят все спеки `test/integration/catalog/*`
 * (см. `vitest.integration.config.ts`: `fileParallelism: false` — файлы строго последовательно,
 * без гонок). `beforeEach` этого файла делает `TRUNCATE medicine_substances, medicines,
 * categories, substances RESTART IDENTITY CASCADE` — тот же приём и тот же набор таблиц, что
 * `catalog-repository.adapter.integration.spec.ts` (DTJ-092); безопасно, т.к. файлы не
 * выполняются параллельно.
 *
 * @see reports/CTO-DECISION-WAVE5.md §3 блок B
 * @see docs/07-WAVE4-HANDOFF.md §3.1 (esbuild/tsc paramtypes) и §3.2 (постмортем «фейковый репозиторий скрыл дефект»)
 */
import type { Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { VersioningType, type INestApplication } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { AppConfigService } from '@/config/app-config.service.js'
import { AppConfigModule } from '@/config/config.module.js'
import { CatalogModule } from '@/modules/catalog/catalog.module.js'
import { SharedKernelModule } from '@/shared-kernel/shared-kernel.module.js'
import { LoggerModule } from '@/common/logging/logger.module.js'
import { DatabaseModule } from '@/infrastructure/database/database.module.js'
import { RedisModule } from '@/infrastructure/redis/redis.module.js'
import { PostgresMedicineReadRepository } from '@/modules/catalog/infrastructure/adapters/postgres-medicine-read.repository.js'
import { ListMedicinesUseCase } from '@/modules/catalog/application/use-cases/list-medicines.use-case.js'
import { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'

/** Тестовая БД: тот же дефолт, что `catalog-repository.adapter.integration.spec.ts`/`vitest.integration.config.ts`. */
const TEST_DATABASE_URL =
  process.env.CATALOG_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url)
const EXTENSIONS_SQL = readFileSync(new URL('0001_extensions.sql', MIGRATIONS_DIR), 'utf8')
const CATALOG_CORE_SQL = readFileSync(new URL('0006_catalog_core.sql', MIGRATIONS_DIR), 'utf8')

// Тестовая пара RS256 — ИДЕНТИЧНА паре в `categories-controller.integration.spec.ts`/
// `auth/test-app.ts` (сгенерирована локально, НЕ секрет, НЕ используется нигде вне vitest).
// Дублируется здесь по той же причине files_owned-изоляции, что и в этих файлах: этот тест
// бутстрапит `CatalogModule`, которая импортирует `AuthModule` (см. `catalog.module.ts`),
// а значит транзитивно инстанцирует `Rs256JwtSignerAdapter`.
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
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://:dorutj_dev_redis_password@localhost:6379',
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

const PROBE_TIMEOUT_MS = 1_500

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

interface TestContext {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

/**
 * Поднимает НАСТОЯЩИЙ `NestApplication` с `CatalogModule` без единого `overrideProvider` —
 * `DRIZZLE_DB` резолвится в реальный пул на `TEST_DATABASE_URL` (тот же приём, что
 * `main.ts`, но без остальных модулей `AppModule`).
 */
async function createRealCatalogApp(): Promise<TestContext> {
  applyTestEnv()
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, SharedKernelModule, LoggerModule, DatabaseModule, RedisModule, CatalogModule],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
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

describe.skipIf(!postgresAvailable)(
  'MEDICINE_READ_REPOSITORY / CATEGORIES_READ_REPOSITORY — real Postgres (DEFECT-FIX, Волна 5 блок B)',
  () => {
    let pool: Pool
    let db: NodePgDatabase

    beforeAll(async () => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL })
      db = drizzle(pool)
      await db.execute(EXTENSIONS_SQL)
      await db.execute(CATALOG_CORE_SQL)
    })

    afterAll(async () => {
      await pool.end().catch(() => undefined)
    })

    beforeEach(async () => {
      await db.execute('TRUNCATE medicine_substances, medicines, categories, substances RESTART IDENTITY CASCADE')
    })

    async function seedCategory(overrides: { slug: string; isActive?: boolean }): Promise<number> {
      const isActive = overrides.isActive ?? true
      const result = await pool.query<{ id: number }>(
        `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
         VALUES ($1, $2, $3, $4, 'otc', 0, $5) RETURNING id`,
        [overrides.slug, `тадж-${overrides.slug}`, `рус-${overrides.slug}`, `en-${overrides.slug}`, isActive],
      )
      const row = result.rows[0]
      if (row === undefined) throw new Error('seedCategory: INSERT ... RETURNING id returned no row')
      return row.id
    }

    async function seedMedicine(opts: {
      id: string
      categoryId: number
      tradeName: string
      isPublished: boolean
      controlCategory?: string
    }): Promise<void> {
      const controlCategory = opts.controlCategory ?? 'none'
      await pool.query(
        `INSERT INTO medicines
           (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
            manufacturer_country, manufacturer_name, is_prescription_required, control_category,
            is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
         VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
                 $5, $6, $7, false, true)`,
        [
          opts.id,
          opts.tradeName,
          `INN-${opts.tradeName}`,
          opts.categoryId,
          controlCategory !== 'none',
          controlCategory,
          opts.isPublished,
        ],
      )
    }

    const CATEGORY_SLUG = 'wave5-block-b-root'
    const MEDICINE_PUBLISHED_ID = '55555555-5555-4555-8555-555555555501'
    const MEDICINE_UNPUBLISHED_ID = '55555555-5555-4555-8555-555555555502'
    const MEDICINE_NARCOTIC_ID = '55555555-5555-4555-8555-555555555503'

    describe('Часть 1: GET /api/v1/categories — HTTP, реальный NestApplication', () => {
      let ctx: TestContext | undefined

      afterEach(async () => {
        if (ctx) await ctx.close()
        ctx = undefined
      })

      it('возвращает засеянную категорию из настоящей БД (не пустой InMemory*)', async () => {
        await seedCategory({ slug: CATEGORY_SLUG })
        ctx = await createRealCatalogApp()

        const res = await request(ctx.httpServer).get('/api/v1/categories')
        expect(res.status).toBe(200)
        const data = (res.body as { data: readonly { slug: string; sortOrder: number }[] }).data
        expect(data.some((c) => c.slug === CATEGORY_SLUG)).toBe(true)
      })

      it('is_active=false → категория отсутствует в ответе (SQL boolean, не integer — см. DEFECT-FOUND постгрес-адаптера)', async () => {
        await seedCategory({ slug: CATEGORY_SLUG, isActive: false })
        ctx = await createRealCatalogApp()

        const res = await request(ctx.httpServer).get('/api/v1/categories')
        expect(res.status).toBe(200)
        const data = (res.body as { data: readonly { slug: string }[] }).data
        expect(data.some((c) => c.slug === CATEGORY_SLUG)).toBe(false)
      })
    })

    describe('Часть 2: PostgresMedicineReadRepository / ListMedicinesUseCase — напрямую, реальный Postgres, БЕЗ фейка', () => {
      function makeRepositoryAndUseCase(): { repo: PostgresMedicineReadRepository; useCase: ListMedicinesUseCase } {
        const repo = new PostgresMedicineReadRepository(db)
        return { repo, useCase: new ListMedicinesUseCase(repo) }
      }

      it('listPublished возвращает засеянный опубликованный медикамент, isPublished=false исключён SQL-фильтром', async () => {
        const categoryId = await seedCategory({ slug: CATEGORY_SLUG })
        await seedMedicine({ id: MEDICINE_PUBLISHED_ID, categoryId, tradeName: 'Wave5-Published', isPublished: true })
        await seedMedicine({ id: MEDICINE_UNPUBLISHED_ID, categoryId, tradeName: 'Wave5-Draft', isPublished: false })
        const { useCase } = makeRepositoryAndUseCase()

        const items = await useCase.execute({ categoryId: null, params: { limit: 20, offset: 0 } })
        const ids = items.map((m) => m.getId())
        expect(ids).toContain(MEDICINE_PUBLISHED_ID)
        expect(ids).not.toContain(MEDICINE_UNPUBLISHED_ID)
      })

      it('listByCategoryId фильтрует по categoryId, controlCategory=narcotic исключён SQL-фильтром (SRS-CAT-006)', async () => {
        const categoryId = await seedCategory({ slug: CATEGORY_SLUG })
        const otherCategoryId = await seedCategory({ slug: `${CATEGORY_SLUG}-other` })
        await seedMedicine({ id: MEDICINE_PUBLISHED_ID, categoryId, tradeName: 'Wave5-InCategory', isPublished: true })
        await seedMedicine({
          id: MEDICINE_NARCOTIC_ID,
          categoryId,
          tradeName: 'Wave5-Narcotic',
          isPublished: true,
          controlCategory: 'narcotic',
        })
        await seedMedicine({
          id: MEDICINE_UNPUBLISHED_ID,
          categoryId: otherCategoryId,
          tradeName: 'Wave5-OtherCategory',
          isPublished: true,
        })
        const { useCase } = makeRepositoryAndUseCase()

        const items = await useCase.execute({ categoryId, params: { limit: 20, offset: 0 } })
        const ids = items.map((m) => m.getId())
        expect(ids).toEqual([MEDICINE_PUBLISHED_ID])
      })

      it('findById возвращает засеянный медикамент по id', async () => {
        const categoryId = await seedCategory({ slug: CATEGORY_SLUG })
        await seedMedicine({ id: MEDICINE_PUBLISHED_ID, categoryId, tradeName: 'Wave5-Published', isPublished: true })
        const { repo } = makeRepositoryAndUseCase()

        const found = await repo.findById(MEDICINE_PUBLISHED_ID)
        expect(found).not.toBeNull()
        expect(found?.getId()).toBe(MEDICINE_PUBLISHED_ID)
        expect(found?.getTradeName()).toBe('Wave5-Published')
      })

      it('findById для controlCategory=psychotropic → null (SRS-CAT-006, существование не подтверждается)', async () => {
        const categoryId = await seedCategory({ slug: CATEGORY_SLUG })
        await seedMedicine({
          id: MEDICINE_NARCOTIC_ID,
          categoryId,
          tradeName: 'Wave5-Psychotropic',
          isPublished: true,
          controlCategory: 'psychotropic',
        })
        const { repo } = makeRepositoryAndUseCase()

        const found = await repo.findById(MEDICINE_NARCOTIC_ID)
        expect(found).toBeNull()
      })

      it('findById для несуществующего id → null', async () => {
        const { repo } = makeRepositoryAndUseCase()
        const found = await repo.findById('00000000-0000-4000-8000-000000000000')
        expect(found).toBeNull()
      })

      it('пагинация: limit/offset применяются на уровне SQL (детерминированный ORDER BY trade_name, id)', async () => {
        const categoryId = await seedCategory({ slug: CATEGORY_SLUG })
        const ids = [
          '55555555-5555-4555-8555-555555555511',
          '55555555-5555-4555-8555-555555555512',
          '55555555-5555-4555-8555-555555555513',
        ]
        await seedMedicine({ id: ids[0]!, categoryId, tradeName: 'A-Medicine', isPublished: true })
        await seedMedicine({ id: ids[1]!, categoryId, tradeName: 'B-Medicine', isPublished: true })
        await seedMedicine({ id: ids[2]!, categoryId, tradeName: 'C-Medicine', isPublished: true })
        const { useCase } = makeRepositoryAndUseCase()

        const page1 = await useCase.execute({ categoryId: null, params: { limit: 2, offset: 0 } })
        const page2 = await useCase.execute({ categoryId: null, params: { limit: 2, offset: 2 } })
        expect(page1.map((m) => m.getTradeName())).toEqual(['A-Medicine', 'B-Medicine'])
        expect(page2.map((m) => m.getTradeName())).toEqual(['C-Medicine'])
      })

      it('substances[] подгружаются батчем (без N+1) для найденного медикамента', async () => {
        const categoryId = await seedCategory({ slug: CATEGORY_SLUG })
        await seedMedicine({ id: MEDICINE_PUBLISHED_ID, categoryId, tradeName: 'Wave5-Published', isPublished: true })
        const substanceId = '11111111-1111-4111-8111-111111111111'
        await pool.query('INSERT INTO substances (id, inn_name) VALUES ($1, $2)', [substanceId, 'Paracetamol'])
        await pool.query(
          'INSERT INTO medicine_substances (medicine_id, substance_id, strength_value, strength_unit) VALUES ($1, $2, $3, $4)',
          [MEDICINE_PUBLISHED_ID, substanceId, '500', 'mg'],
        )
        const { repo } = makeRepositoryAndUseCase()

        const found = await repo.findById(MEDICINE_PUBLISHED_ID)
        expect(found).not.toBeNull()
        expect(found?.getSubstances()).toHaveLength(1)
        expect(found?.getSubstances()[0]?.substanceId).toBe(substanceId)
        expect(found?.getControlCategory()).toBe(ControlCategory.none)
      })
    })
  },
)
