/**
 * Интеграционный тест `AnalogsController` (DTJ-102, EP-07) —
 * `GET /api/v1/medicines/:id/analogs`, РЕАЛЬНЫЙ `NestApplication` + РЕАЛЬНЫЙ Postgres
 * (тот же приём бутстрапа, что `catalog-read-endpoints.integration.spec.ts`: `CatalogModule`
 * без единого `overrideProvider` — за ОДНИМ обоснованным исключением, см. ниже).
 *
 * **Единственное переопределение — `ANALOG_OFFER_LOOKUP_PORT`.** Продакшен-биндинг —
 * `NullAnalogOfferLookupAdapter` (DTJ-101, ВСЕГДА пустой `Map` — реальная инфраструктура
 * `InventoryFacade.getStockAndPriceBatch` ещё не существует, порт согласован как
 * «безопасный заглушечный режим», см. его собственный JSDoc: «Реальная реализация —
 * отдельный тикет, который ЗАМЕНИТ NullAnalogOfferLookupAdapter через DI-биндинг»).
 * Это НЕ тот запрещённый паттерн из `reports/EP09-CTO-BRIEF.md` §6.4 («интеграционный
 * тест обязан бить в настоящий Postgres, подмена репозитория фейком запрещена») —
 * там речь о РЕАЛЬНОЙ инфраструктуре, подменённой ради удобства теста; здесь
 * заменяется УЖЕ ЗАЯВЛЕННАЯ, санкционированная архитектурой заглушка, реальной
 * реализации которой в природе не существует. Без этой замены `items` были бы
 * `[]` ВСЕГДА и TC-CAT-015/016 (микс Rx/OTC, ненулевая экономия) физически
 * непроверяемы. `CATALOG_REPOSITORY`/`ANALOG_CANDIDATES_REPOSITORY`/
 * `I18N_OVERRIDES_REPOSITORY` — ВСЕ настоящие Drizzle-адаптеры на настоящем Postgres.
 *
 * Сценарии (буквально TC-CAT-015/016 + критерии приёмки DTJ-102):
 *   - TC-CAT-015: `disclaimer` присутствует НЕЗАВИСИМО от `savingsDiram` — включая
 *     ПУСТОЙ список аналогов (решение CTO D-EP07-2: пустой список — тоже рендер).
 *   - TC-CAT-016: список содержит один OTC и один Rx аналог — `isPrescriptionRequired`
 *     присутствует ТОЛЬКО у Rx-элемента.
 *   - `savingsDiram <= 0` → `titleKey = catalog.analogs.title_neutral`, `items` непусты.
 *   - `savingsDiram > 0` → `titleKey = catalog.analogs.title_savings`.
 *   - `Accept-Language: en/ru/tj` → `disclaimer` — соответствующий язык (SRS-CAT-039).
 *   - Несуществующий `medicineId` → `404`.
 *
 * **Изоляция от соседних файлов.** Фиксированный UUID-namespace `...-4000-8000-0000000000bNN`
 * (не пересекается ни с одной фикстурой `test/integration/catalog/*`, свой `CATEGORY_SLUG`).
 * `beforeEach` удаляет ТОЛЬКО свои строки (`DELETE`, не `TRUNCATE ... CASCADE` — урок
 * волны 5, `reports/EP09-CTO-BRIEF.md` §6.5) и НЕ трогает нейтрального тенанта/
 * `i18n_overrides` (сидит их ОДИН раз в `beforeAll` — тот же контент, что
 * `i18n-overrides-catalog.seed.ts`, DTJ-103).
 *
 * **Миграция `0024_i18n_overrides_review_status.sql` применяется здесь НАПРЯМУЮ
 * (`db.execute(readFileSync(...))`), не через `migrate()` — этот файл не зависит от
 * порядка запуска соседних `*.spec.ts` (алфавитный порядок ставит `analogs.controller...`
 * РАНЬШЕ `i18n-overrides-catalog.seed...`). Тот же приём и то же обоснование (permission
 * denied на `drizzle`-схеме `dorutj_test3`), что в `i18n-overrides-catalog.seed.integration.spec.ts`
 * — см. её JSDoc за полным разбором.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-039/040/042, TC-CAT-015/016)
 * @see tickets/ep03-catalog-analogs/DTJ-102.md
 */
import type { Server } from 'node:http'
import { readFileSync } from 'node:fs'
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
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PharmacyOfferPublic } from '@dorutj/contracts'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { AppConfigService } from '@/config/app-config.service.js'
import { AppConfigModule } from '@/config/config.module.js'
import { CatalogModule } from '@/modules/catalog/catalog.module.js'
import { SharedKernelModule } from '@/shared-kernel/shared-kernel.module.js'
import { LoggerModule } from '@/common/logging/logger.module.js'
import { DatabaseModule } from '@/infrastructure/database/database.module.js'
import { RedisModule } from '@/infrastructure/redis/redis.module.js'
import { TenantContext, type TenantContextStore } from '@/common/context/tenant-context.js'
import {
  ANALOG_OFFER_LOOKUP_PORT,
  type AnalogOfferLookupInput,
  type AnalogOfferLookupPort,
} from '@/modules/catalog/application/ports/analog-offer-lookup.port.js'
import { seedI18nOverridesCatalog, I18N_SEED_NEUTRAL_TENANT_ID } from '@/db/seed/i18n-overrides-catalog.seed.js'

const TEST_DATABASE_URL =
  process.env.CATALOG_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

/**
 * ИСПРАВЛЕНО (гейт CI): DDL (реплей `0024_i18n_overrides_review_status.sql`) обязан идти под
 * ролью-владельцем объектов `public` — `dorutj_migrator`, не под `test` (см. JSDoc
 * `i18n-overrides-catalog.seed.integration.spec.ts`, раздел «ИСПРАВЛЕНО», тот же приём здесь).
 * Когда реальные миграции уже применены `dorutj_migrator`, повторный `ALTER TABLE ... ADD
 * COLUMN`/`ADD CONSTRAINT` под `test` падает «must be owner of table i18n_overrides» — DDL
 * требует владения, не DML-привилегий из `ALTER DEFAULT PRIVILEGES`.
 */
const MIGRATOR_DATABASE_URL = process.env.CATALOG_MIGRATOR_DATABASE_URL ?? buildMigratorUrl(TEST_DATABASE_URL)

function buildMigratorUrl(appUrl: string): string {
  try {
    const url = new URL(appUrl)
    url.username = 'dorutj_migrator'
    // Дев-дефолт, коммитится в открытом виде (правило 13 AGENTS.md), не секрет.
    url.password = 'dorutj_dev_only_password'
    return url.toString()
  } catch {
    return appUrl
  }
}

const MIGRATIONS_URL = new URL('../../../migrations/', import.meta.url)
const MIGRATION_0024_SQL = readFileSync(new URL('0024_i18n_overrides_review_status.sql', MIGRATIONS_URL), 'utf8')

// Тестовая пара RS256 — тот же приём files_owned-изоляции, что
// `catalog-read-endpoints.integration.spec.ts` (CatalogModule импортирует AuthModule транзитивно).
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
const migratorAvailable = postgresAvailable && (await isPostgresReachable(MIGRATOR_DATABASE_URL))

/**
 * `AnalogsController` резолвит `TenantId` из `TenantContext` (`resolveTenantId()`, тот же
 * приём, что `PharmaciesMapController`/`CatalogSearchController`) — в проде его ставит
 * `TenantResolutionMiddleware` (`tenancy`-модуль, вне `files_owned` этого тикета, править
 * запрещено). `pharmacies-map-controller.integration.spec.ts` (DTJ-197) уже решило эту же
 * задачу для ЭТОГО ЖЕ минимального набора модулей — `FixedTenantContextMiddleware`/
 * `FixedTenantContextModule` ниже дублируют ТОТ ЖЕ приём (легитимное использование
 * ПУБЛИЧНОГО API `TenantContext.run`, не правка чужого файла), но с РЕАЛЬНЫМ UUID
 * нейтрального тенанта (не произвольным фикстурным) — `resolveDisclaimer` находит
 * `catalog.analogs.disclaimer` для `tenantId = I18N_SEED_NEUTRAL_TENANT_ID` С ПЕРВОЙ
 * попытки, без захода в фолбэк-ветку (реалистичный сценарий: подавляющее большинство
 * публичных запросов резолвятся именно в нейтральный тенант).
 */
const FIXED_TENANT_STORE: TenantContextStore = {
  tenantId: I18N_SEED_NEUTRAL_TENANT_ID,
  slug: 'neutral',
  chainId: null,
  isNeutral: true,
  unresolved: false,
  unresolvedReason: null,
}

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

/**
 * Тестовый двойник `ANALOG_OFFER_LOOKUP_PORT` — см. JSDoc файла (замена САНКЦИОНИРОВАННОЙ
 * заглушки, не реальной инфраструктуры). `setOffers`/`reset` управляются тестом напрямую.
 */
class FakeAnalogOfferLookupAdapter implements AnalogOfferLookupPort {
  private offersByMedicineId = new Map<string, readonly PharmacyOfferPublic[]>()

  setOffers(medicineId: string, offers: readonly PharmacyOfferPublic[]): void {
    this.offersByMedicineId.set(medicineId, offers)
  }

  reset(): void {
    this.offersByMedicineId.clear()
  }

  getOffersForMedicines(input: AnalogOfferLookupInput): Promise<ReadonlyMap<string, readonly PharmacyOfferPublic[]>> {
    const result = new Map<string, readonly PharmacyOfferPublic[]>()
    for (const id of input.medicineIds) {
      const offers = this.offersByMedicineId.get(id)
      if (offers !== undefined) result.set(id, offers)
    }
    return Promise.resolve(result)
  }
}

function offer(pharmacyId: string, priceDiram: number): PharmacyOfferPublic {
  return { pharmacyId, priceDiram, distanceMeters: 800, isStale: false, lastSyncedAt: null }
}

interface TestContext {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

/** Реальный `NestApplication`, `CatalogModule` без единого `overrideProvider` — КРОМЕ offer-порта (см. JSDoc файла). */
async function createRealCatalogApp(fakeOfferLookup: FakeAnalogOfferLookupAdapter): Promise<TestContext> {
  applyTestEnv()
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
    .overrideProvider(ANALOG_OFFER_LOOKUP_PORT)
    .useValue(fakeOfferLookup)
    .compile()
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

const CATEGORY_SLUG = 'ep07-analogs-controller-root'
const SUBSTANCE_ID = '00000000-0000-4000-8000-0000000000b1'
const REFERENCE_ID = '00000000-0000-4000-8000-0000000000b2'
const ANALOG_OTC_ID = '00000000-0000-4000-8000-0000000000b3'
const ANALOG_RX_ID = '00000000-0000-4000-8000-0000000000b4'
const NO_ANALOGS_SUBSTANCE_ID = '00000000-0000-4000-8000-0000000000b5'
const NO_ANALOGS_MEDICINE_ID = '00000000-0000-4000-8000-0000000000b6'
const NONEXISTENT_ID = '00000000-0000-4000-8000-0000000000bf'
const PHARMACY_REF = '00000000-0000-4000-8000-0000000000c1'
const PHARMACY_OTC = '00000000-0000-4000-8000-0000000000c2'
const PHARMACY_RX = '00000000-0000-4000-8000-0000000000c3'

describe.skipIf(!postgresAvailable || !migratorAvailable)('AnalogsController — GET /api/v1/medicines/:id/analogs (integration, DTJ-102)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let migratorPool: Pool
  let fakeOfferLookup: FakeAnalogOfferLookupAdapter
  let ctx: TestContext | undefined
  let categoryId: number

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    migratorPool = new Pool({ connectionString: MIGRATOR_DATABASE_URL })
    // DDL — под ролью-владельцем объектов `public` (`dorutj_migrator`), не под `test`
    // (см. блок «ИСПРАВЛЕНО» у объявления MIGRATOR_DATABASE_URL). Прямое исполнение SQL
    // миграции (не бухгалтерский `migrate()`) — остальное обоснование см. JSDoc файла.
    await migratorPool.query(MIGRATION_0024_SQL)
    // DTJ-103: контент дисклеймера — тот же путь, что боевой `pnpm db:seed` (см. его JSDoc).
    // Сид — DML, остаётся под `test` (`db`), как и раньше.
    await seedI18nOverridesCatalog(db)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
    await migratorPool.end().catch(() => undefined)
  })

  afterEach(async () => {
    if (ctx) await ctx.close()
    ctx = undefined
    // Убирает мусор и после ПОСЛЕДНЕГО теста файла (иначе beforeEach следующего запуска
    // чистит его, но между прогонами в БД остаются посторонние строки) — тот же приём,
    // что `postgres-pharmacy-map.adapter.integration.spec.ts` (cleanupOwnRows в обоих хуках).
    await cleanupOwnRows()
  })

  beforeEach(async () => {
    fakeOfferLookup = new FakeAnalogOfferLookupAdapter()
    await cleanupOwnRows()
    categoryId = await seedCategory()
    await seedSubstance(SUBSTANCE_ID, 'Paracetamol')
    await seedSubstance(NO_ANALOGS_SUBSTANCE_ID, 'UniqueSubstanceEP07')
    await seedMedicine({
      id: REFERENCE_ID,
      tradeName: 'Reference-EP07',
      isPrescriptionRequired: false,
      substanceId: SUBSTANCE_ID,
    })
    await seedMedicine({
      id: ANALOG_OTC_ID,
      tradeName: 'Analog-OTC-EP07',
      isPrescriptionRequired: false,
      substanceId: SUBSTANCE_ID,
    })
    await seedMedicine({
      id: ANALOG_RX_ID,
      tradeName: 'Analog-RX-EP07',
      isPrescriptionRequired: true,
      substanceId: SUBSTANCE_ID,
    })
    await seedMedicine({
      id: NO_ANALOGS_MEDICINE_ID,
      tradeName: 'Solo-EP07',
      isPrescriptionRequired: false,
      substanceId: NO_ANALOGS_SUBSTANCE_ID,
    })
  })

  async function cleanupOwnRows(): Promise<void> {
    await pool.query('DELETE FROM medicine_substances WHERE medicine_id = ANY($1::uuid[])', [
      [REFERENCE_ID, ANALOG_OTC_ID, ANALOG_RX_ID, NO_ANALOGS_MEDICINE_ID],
    ])
    await pool.query('DELETE FROM medicines WHERE id = ANY($1::uuid[])', [
      [REFERENCE_ID, ANALOG_OTC_ID, ANALOG_RX_ID, NO_ANALOGS_MEDICINE_ID],
    ])
    await pool.query('DELETE FROM substances WHERE id = ANY($1::uuid[])', [[SUBSTANCE_ID, NO_ANALOGS_SUBSTANCE_ID]])
    await pool.query('DELETE FROM categories WHERE slug = $1', [CATEGORY_SLUG])
  }

  async function seedCategory(): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ($1, 'тадж', 'рус', 'en', 'otc', 0, true) RETURNING id`,
      [CATEGORY_SLUG],
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error('seedCategory: no row returned')
    return row.id
  }

  async function seedSubstance(id: string, innName: string): Promise<void> {
    await pool.query('INSERT INTO substances (id, inn_name) VALUES ($1, $2)', [id, innName])
  }

  async function seedMedicine(opts: {
    id: string
    tradeName: string
    isPrescriptionRequired: boolean
    substanceId: string
  }): Promise<void> {
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               $5, $6, true, false, true)`,
      [
        opts.id,
        opts.tradeName,
        `INN-${opts.tradeName}`,
        categoryId,
        opts.isPrescriptionRequired,
        opts.isPrescriptionRequired ? 'prescription_only' : 'none',
      ],
    )
    await pool.query(
      'INSERT INTO medicine_substances (medicine_id, substance_id, strength_value, strength_unit) VALUES ($1, $2, 500, $3)',
      [opts.id, opts.substanceId, 'mg'],
    )
  }

  it('TC-CAT-015: disclaimer присутствует независимо от savingsDiram (список непуст)', async () => {
    fakeOfferLookup.setOffers(REFERENCE_ID, [offer(PHARMACY_REF, 3000)])
    fakeOfferLookup.setOffers(ANALOG_OTC_ID, [offer(PHARMACY_OTC, 1800)])
    ctx = await createRealCatalogApp(fakeOfferLookup)

    const res = await request(ctx.httpServer).get(`/api/v1/medicines/${REFERENCE_ID}/analogs`)
    expect(res.status).toBe(200)
    const data = (res.body as { data: { disclaimer: string; items: unknown[] } }).data
    expect(typeof data.disclaimer).toBe('string')
    expect(data.disclaimer.length).toBeGreaterThan(0)
    expect(data.items.length).toBeGreaterThan(0)
  })

  it('TC-CAT-015: disclaimer присутствует и при ПУСТОМ списке аналогов (решение CTO D-EP07-2)', async () => {
    ctx = await createRealCatalogApp(fakeOfferLookup)

    const res = await request(ctx.httpServer).get(`/api/v1/medicines/${NO_ANALOGS_MEDICINE_ID}/analogs`)
    expect(res.status).toBe(200)
    const data = (res.body as { data: { disclaimer: string; items: unknown[] } }).data
    expect(data.items).toEqual([])
    expect(typeof data.disclaimer).toBe('string')
    expect(data.disclaimer.length).toBeGreaterThan(0)
  })

  it('TC-CAT-016: isPrescriptionRequired присутствует ТОЛЬКО у Rx-элемента (микс OTC/Rx)', async () => {
    fakeOfferLookup.setOffers(REFERENCE_ID, [offer(PHARMACY_REF, 3000)])
    fakeOfferLookup.setOffers(ANALOG_OTC_ID, [offer(PHARMACY_OTC, 1800)])
    fakeOfferLookup.setOffers(ANALOG_RX_ID, [offer(PHARMACY_RX, 2000)])
    ctx = await createRealCatalogApp(fakeOfferLookup)

    const res = await request(ctx.httpServer).get(`/api/v1/medicines/${REFERENCE_ID}/analogs`)
    expect(res.status).toBe(200)
    const items = (
      res.body as {
        data: { items: readonly { medicineId: string; isPrescriptionRequired: boolean }[] }
      }
    ).data.items
    expect(items).toHaveLength(2)
    const otcItem = items.find((i) => i.medicineId === ANALOG_OTC_ID)
    const rxItem = items.find((i) => i.medicineId === ANALOG_RX_ID)
    expect(otcItem?.isPrescriptionRequired).toBe(false)
    expect(rxItem?.isPrescriptionRequired).toBe(true)
  })

  it('savingsDiram > 0 → titleKey = catalog.analogs.title_savings', async () => {
    fakeOfferLookup.setOffers(REFERENCE_ID, [offer(PHARMACY_REF, 3000)])
    fakeOfferLookup.setOffers(ANALOG_OTC_ID, [offer(PHARMACY_OTC, 1800)])
    ctx = await createRealCatalogApp(fakeOfferLookup)

    const res = await request(ctx.httpServer).get(`/api/v1/medicines/${REFERENCE_ID}/analogs`)
    const data = (res.body as { data: { savingsDiram: number | null; titleKey: string } }).data
    expect(data.savingsDiram).toBe(1200)
    expect(data.titleKey).toBe('catalog.analogs.title_savings')
  })

  it('savingsDiram <= 0 (референс дешевле аналога) → titleKey = catalog.analogs.title_neutral, items непусты', async () => {
    fakeOfferLookup.setOffers(REFERENCE_ID, [offer(PHARMACY_REF, 1000)])
    fakeOfferLookup.setOffers(ANALOG_OTC_ID, [offer(PHARMACY_OTC, 1800)])
    ctx = await createRealCatalogApp(fakeOfferLookup)

    const res = await request(ctx.httpServer).get(`/api/v1/medicines/${REFERENCE_ID}/analogs`)
    const data = (res.body as { data: { savingsDiram: number | null; titleKey: string; items: unknown[] } }).data
    expect(data.savingsDiram).toBeNull()
    expect(data.titleKey).toBe('catalog.analogs.title_neutral')
    expect(data.items.length).toBeGreaterThan(0)
  })

  it.each([
    ['en', 'This is not medical advice.'],
    ['ru', 'Это не медицинская рекомендация.'],
    ['tj', 'Ин тавсияи тиббӣ нест.'],
  ] as const)('Accept-Language: %s → disclaimer на соответствующем языке', async (lang, expectedPrefix) => {
    ctx = await createRealCatalogApp(fakeOfferLookup)

    const res = await request(ctx.httpServer)
      .get(`/api/v1/medicines/${NO_ANALOGS_MEDICINE_ID}/analogs`)
      .set('Accept-Language', lang)
    expect(res.status).toBe(200)
    const disclaimer = (res.body as { data: { disclaimer: string } }).data.disclaimer
    expect(disclaimer.startsWith(expectedPrefix)).toBe(true)
  })

  it('несуществующий medicineId → 404', async () => {
    ctx = await createRealCatalogApp(fakeOfferLookup)

    const res = await request(ctx.httpServer).get(`/api/v1/medicines/${NONEXISTENT_ID}/analogs`)
    expect(res.status).toBe(404)
  })
})
