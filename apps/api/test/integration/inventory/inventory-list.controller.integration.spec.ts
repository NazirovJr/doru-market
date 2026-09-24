// Harness — узкий testing-модуль (не весь InventoryModule с его BullMQ/Redis, не используемыми
// здесь). tenantId: null во всех тестовых JWT — AuthGuard пропускает cross-tenant проверку для
// null, поэтому TenantContext-хук не нужен.
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import type { Server } from 'node:http'
import { type INestApplication, Module, VersioningType } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { ResponseInterceptor } from '@/common/http/interceptors/response.interceptor.js'
import { AppConfigService } from '@/config/app-config.service.js'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { PHARMACY_INVENTORY_REPOSITORY } from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'
import { DrizzlePharmacyInventoryRepository } from '@/modules/inventory/infrastructure/adapters/drizzle-pharmacy-inventory.repository.js'
import { ListPharmacyInventoryUseCase } from '@/modules/inventory/application/use-cases/list-pharmacy-inventory.use-case.js'
import { InventoryListController } from '@/modules/inventory/presentation/controllers/inventory-list.controller.js'

const TEST_DATABASE_URL =
  process.env.INVENTORY_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
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

const { privateKey: TEST_JWT_PRIVATE_KEY, publicKey: TEST_JWT_PUBLIC_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: 'redis://localhost:6380/0',
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: '60',
  OTP_REQUEST_MAX_PER_10MIN: '3',
  OTP_REQUEST_MAX_PER_DAY: '10',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_inventory_list',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-inventory-list',
  CART_HOLD_TTL_SECONDS: '900',
}

function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
}

@Module({
  imports: [AuthModule],
  controllers: [InventoryListController],
  providers: [
    { provide: PHARMACY_INVENTORY_REPOSITORY, useClass: DrizzlePharmacyInventoryRepository },
    ListPharmacyInventoryUseCase,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- модуль тест-харнесса
class InventoryListTestModule {}

interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

async function createTestApp(): Promise<TestApp> {
  applyTestEnv()
  const { AppConfigModule } = await import('@/config/config.module.js')
  const { LoggerModule } = await import('@/common/logging/logger.module.js')
  const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
  const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')

  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, AuthModule, InventoryListTestModule],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  const config = app.get(AppConfigService)
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  const httpServer = app.getHttpServer()
  return {
    app,
    httpServer,
    close: async (): Promise<void> => {
      const db = app.get<DrizzleDb>(DRIZZLE_DB) as DrizzleDb & { $client: Pool }
      await app.close()
      await db.$client.end()
    },
  }
}

interface SuccessBody<T> {
  readonly data: T
  readonly meta?: { readonly pagination?: { readonly nextCursor: string | null; readonly hasMore: boolean; readonly limit: number } }
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string }
}
interface InventoryItemBody {
  readonly inventoryId: string
  readonly medicineId: string
  readonly tradeName: string
  readonly priceDiram: number
  readonly stockQuantity: number
}

const CATEGORY_SLUG = 'test-inventory-list-171'

describe.skipIf(!postgresAvailable)('InventoryListController — Supertest integration (DTJ-171)', () => {
  let pool: Pool
  let ctx: TestApp
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const seededMedicineIds: string[] = []
  const seededPharmacyIds: string[] = []

  beforeAll(async () => {
    ctx = await createTestApp()
    httpServer = ctx.httpServer
    jwtSigner = ctx.app.get<JwtSignerPort>(JWT_SIGNER)
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
  })

  afterAll(async () => {
    await ctx.close()
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    if (seededPharmacyIds.length > 0) {
      await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [seededPharmacyIds])
      seededPharmacyIds.length = 0
    }
    if (seededMedicineIds.length > 0) {
      await pool.query('DELETE FROM medicines WHERE id = ANY($1)', [seededMedicineIds])
      seededMedicineIds.length = 0
    }
  })

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  function pharmacistToken(pharmacyId: string | null): string {
    return sign({ sub: randomUUID(), role: 'pharmacist', tenantId: null, pharmacyId, chainId: null })
  }

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy DTJ-171', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000001')`,
      [id],
    )
    seededPharmacyIds.push(id)
    return id
  }

  async function ensureCategory(): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ($1, 'Категория', 'Категория', 'Category', 'otc', 0, true)
       ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
       RETURNING id`,
      [CATEGORY_SLUG],
    )
    const categoryId = result.rows[0]?.id
    if (categoryId === undefined) {
      throw new Error('ensureCategory: failed to resolve category id')
    }
    return categoryId
  }

  async function seedMedicine(tradeName: string): Promise<string> {
    const id = randomUUID()
    const categoryId = await ensureCategory()
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, true)`,
      [id, tradeName, `INN-${id}`, categoryId],
    )
    seededMedicineIds.push(id)
    return id
  }

  async function seedInventoryRow(params: {
    pharmacyId: string
    medicineId: string
    price: number
    quantity?: number
    expiresAt?: string
    batchNumber?: string | null
  }): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        params.pharmacyId,
        params.medicineId,
        params.price,
        params.quantity ?? 10,
        params.expiresAt ?? '2030-01-01',
        params.batchNumber ?? null,
      ],
    )
    return id
  }

  interface InventoryPage {
    readonly items: readonly InventoryItemBody[]
    readonly nextCursor: string | null
    readonly hasMore: boolean
  }

  async function fetchInventoryListPage(token: string, cursor: string | null): Promise<InventoryPage> {
    const cursorQuery = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
    const response = await request(httpServer).get(`/api/v1/inventory?limit=50${cursorQuery}`).set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    const body = response.body as SuccessBody<InventoryItemBody[]>
    const pagination = body.meta?.pagination
    return { items: body.data, nextCursor: pagination?.nextCursor ?? null, hasMore: pagination?.hasMore ?? false }
  }

  it('критерий 1: 120 позиций, limit=50, два прохода по nextCursor — 50+50+20 без дублей/пропусков, hasMore=false на последней', async () => {
    const pharmacyId = await seedPharmacy()
    const paddedNames = Array.from({ length: 120 }, (_, i) => `Med-${String(i).padStart(3, '0')}`)
    for (const tradeName of paddedNames) {
      const medicineId = await seedMedicine(tradeName)
      await seedInventoryRow({ pharmacyId, medicineId, price: 100 })
    }
    const token = pharmacistToken(pharmacyId)

    const page1 = await fetchInventoryListPage(token, null)
    expect(page1.items).toHaveLength(50)
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).toBeTruthy()

    const page2 = await fetchInventoryListPage(token, page1.nextCursor)
    expect(page2.items).toHaveLength(50)
    expect(page2.hasMore).toBe(true)

    const page3 = await fetchInventoryListPage(token, page2.nextCursor)
    expect(page3.items).toHaveLength(20)
    expect(page3.hasMore).toBe(false)

    const allItems = [...page1.items, ...page2.items, ...page3.items]
    expect(new Set(allItems.map((item) => item.inventoryId)).size).toBe(120)
    const allTradeNames = allItems.map((item) => item.tradeName)
    expect(allTradeNames).toEqual([...allTradeNames].sort())
  })

  it('критерий 2: остатки двух аптек — чужой pharmacyId в query игнорируется, только своя аптека в ответе', async () => {
    const pharmacyA = await seedPharmacy()
    const pharmacyB = await seedPharmacy()
    const medicineA = await seedMedicine('Only-A-Medicine')
    const medicineB = await seedMedicine('Only-B-Medicine')
    await seedInventoryRow({ pharmacyId: pharmacyA, medicineId: medicineA, price: 100 })
    await seedInventoryRow({ pharmacyId: pharmacyB, medicineId: medicineB, price: 200 })
    const tokenA = pharmacistToken(pharmacyA)

    const response = await request(httpServer)
      .get(`/api/v1/inventory?filter[pharmacyId]=${pharmacyB}`)
      .set('Authorization', `Bearer ${tokenA}`)

    expect(response.status).toBe(200)
    const body = response.body as SuccessBody<InventoryItemBody[]>
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.medicineId).toBe(medicineA)
  })

  it('критерий 3: customer/аноним получают 403/401', async () => {
    const pharmacyId = await seedPharmacy()
    const customerToken = sign({ sub: randomUUID(), role: 'customer', tenantId: null, pharmacyId: null, chainId: null })

    const asCustomer = await request(httpServer).get('/api/v1/inventory').set('Authorization', `Bearer ${customerToken}`)
    expect(asCustomer.status).toBe(403)
    expect((asCustomer.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')

    const anonymous = await request(httpServer).get('/api/v1/inventory')
    expect(anonymous.status).toBe(401)
    expect((anonymous.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')

    void pharmacyId
  })

  it('критерий 4: limit=101 → 400, курсор с полем v не того типа → 400 (без 500 и без обрезания)', async () => {
    const pharmacyId = await seedPharmacy()
    const token = pharmacistToken(pharmacyId)

    const badLimit = await request(httpServer).get('/api/v1/inventory?limit=101').set('Authorization', `Bearer ${token}`)
    expect(badLimit.status).toBe(400)
    expect((badLimit.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')

    const badCursor = Buffer.from(JSON.stringify({ v: 42, id: 'x' }), 'utf-8').toString('base64url')
    const badCursorResponse = await request(httpServer)
      .get(`/api/v1/inventory?cursor=${badCursor}`)
      .set('Authorization', `Bearer ${token}`)
    expect(badCursorResponse.status).toBe(400)
    expect((badCursorResponse.body as ErrorBody).error.code).toBe('INVALID_CURSOR')
  })

  it('критерий 5: price=12550 (эквивалент 125.50 TJS в дирамах) → priceDiram=12550 без искажения', async () => {
    const pharmacyId = await seedPharmacy()
    const medicineId = await seedMedicine('Priced-Medicine')
    await seedInventoryRow({ pharmacyId, medicineId, price: 12_550 })
    const token = pharmacistToken(pharmacyId)

    const response = await request(httpServer).get('/api/v1/inventory').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    const body = response.body as SuccessBody<InventoryItemBody[]>
    expect(body.data[0]?.priceDiram).toBe(12_550)
  })

  it('без pharmacyId в токене — 400 VALIDATION_ERROR', async () => {
    const token = pharmacistToken(null)
    const response = await request(httpServer).get('/api/v1/inventory').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(400)
    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })
})
