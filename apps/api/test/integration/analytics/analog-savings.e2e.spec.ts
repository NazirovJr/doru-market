// Интеграционный тест DTJ-385 — реальный Postgres, `AnalyticsModule` целиком (тянет `CatalogModule`
// транзитивно). Единственное переопределение — `ANALOG_OFFER_LOOKUP_PORT` (та же САНКЦИОНИРОВАННАЯ
// подмена, что `analogs.controller.integration.spec.ts`: продакшен-биндинг — `NullAnalogOfferLookupAdapter`,
// реальной инфраструктуры офферов ещё нет, см. JSDoc порта).
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import { Pool } from 'pg'
import { Test } from '@nestjs/testing'
import { Injectable } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PharmacyOfferPublic } from '@dorutj/contracts'
import {
  ANALOG_OFFER_LOOKUP_PORT,
  type AnalogOfferLookupInput,
  type AnalogOfferLookupPort,
} from '@/modules/catalog/application/ports/analog-offer-lookup.port.js'

const TEST_DATABASE_URL =
  process.env.ANALYTICS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

const REQUIRED_TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6380/0',
  LOG_LEVEL: 'silent',
}

// AnalyticsModule импортирует AuthModule (DTJ-379, guard телеметрии) — Rs256JwtSignerAdapter требует ключи.
function applyRequiredTestEnv(): void {
  for (const [key, value] of Object.entries(REQUIRED_TEST_ENV)) {
    process.env[key] ??= value
  }
  if (process.env.JWT_PRIVATE_KEY === undefined || process.env.JWT_PUBLIC_KEY === undefined) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    process.env.JWT_PRIVATE_KEY = privateKey
    process.env.JWT_PUBLIC_KEY = publicKey
    process.env.JWT_KID = 'test-v1-dtj385'
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

@Injectable()
class FakeAnalogOfferLookupAdapter implements AnalogOfferLookupPort {
  private offersByMedicineId = new Map<string, readonly PharmacyOfferPublic[]>()

  setOffers(medicineId: string, offers: readonly PharmacyOfferPublic[]): void {
    this.offersByMedicineId.set(medicineId, offers)
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

const FULL_BOOT_TIMEOUT_MS = 30_000

describe.skipIf(!postgresAvailable)('analog_shown/added_to_cart — серверная экономия (DTJ-385)', () => {
  let pool: Pool
  let tenantId: string
  let categoryId: number
  let referenceId: string
  let analogId: string
  let fakeOfferLookup: FakeAnalogOfferLookupAdapter

  beforeAll(async () => {
    applyRequiredTestEnv()
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    tenantId = randomUUID()
    referenceId = randomUUID()
    analogId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      tenantId,
      `dtj385-${tenantId.slice(0, 8)}`,
    ])
    const categoryResult = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ($1, 'тадж', 'рус', 'en', 'otc', 0, true) RETURNING id`,
      [`dtj385-${tenantId.slice(0, 8)}`],
    )
    const categoryRow = categoryResult.rows[0]
    if (categoryRow === undefined) throw new Error('seedCategory: no row returned')
    categoryId = categoryRow.id
    await seedMedicine(referenceId, 'Reference-DTJ385')
    await seedMedicine(analogId, 'Analog-DTJ385')
  })

  afterAll(async () => {
    await pool.query('DELETE FROM product_events WHERE tenant_id = $1', [tenantId])
    await pool.query('DELETE FROM medicines WHERE id = ANY($1::uuid[])', [[referenceId, analogId]])
    await pool.query('DELETE FROM categories WHERE id = $1', [categoryId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end().catch(() => undefined)
  })

  async function seedMedicine(id: string, tradeName: string): Promise<void> {
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, true)`,
      [id, tradeName, `INN-${tradeName}`, categoryId],
    )
  }

  async function bootModule() {
    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
    const { AnalyticsModule } = await import('@/modules/analytics/index.js')
    const { RecordProductEventsBatchUseCase } = await import(
      '@/modules/analytics/application/use-cases/record-product-events-batch.use-case.js'
    )
    const { RealizedSavingsCalculator } = await import(
      '@/modules/analytics/application/services/realized-savings-calculator.js'
    )

    fakeOfferLookup = new FakeAnalogOfferLookupAdapter()
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, AnalyticsModule],
    })
      .overrideProvider(ANALOG_OFFER_LOOKUP_PORT)
      .useValue(fakeOfferLookup)
      .compile()

    return {
      batchUseCase: moduleRef.get(RecordProductEventsBatchUseCase),
      realizedSavings: moduleRef.get(RealizedSavingsCalculator),
      close: () => moduleRef.close(),
    }
  }

  it(
    'АС1: клиент присылает savingsDiram=100000000, сервер по офферам считает 5000 — записывается 5000',
    async () => {
      fakeOfferLookup = new FakeAnalogOfferLookupAdapter()
      const { batchUseCase, close } = await bootModule()
      fakeOfferLookup.setOffers(referenceId, [offer('pharm-ref', 6000)])
      fakeOfferLookup.setOffers(analogId, [offer('pharm-analog', 1000)])
      const sessionId = `session-${randomUUID()}`

      await batchUseCase.execute({
        tenantId,
        userId: null,
        events: [
          {
            eventType: 'analog_shown',
            sessionId,
            referenceMedicineId: referenceId,
            medicineId: analogId,
            savingsDiram: 100_000_000n,
          },
        ],
      })

      const rows = await pool.query<{ savings_diram: string | null }>(
        'SELECT savings_diram FROM product_events WHERE session_id = $1',
        [sessionId],
      )
      expect(rows.rows).toEqual([{ savings_diram: '5000' }])
      await close()
    },
    FULL_BOOT_TIMEOUT_MS,
  )

  it(
    'АС2: аналог не дешевле референса — savings_diram = null',
    async () => {
      fakeOfferLookup = new FakeAnalogOfferLookupAdapter()
      const { batchUseCase, close } = await bootModule()
      fakeOfferLookup.setOffers(referenceId, [offer('pharm-ref', 1000)])
      fakeOfferLookup.setOffers(analogId, [offer('pharm-analog', 1800)])
      const sessionId = `session-${randomUUID()}`

      await batchUseCase.execute({
        tenantId,
        userId: null,
        events: [{ eventType: 'analog_shown', sessionId, referenceMedicineId: referenceId, medicineId: analogId }],
      })

      const rows = await pool.query<{ savings_diram: string | null }>(
        'SELECT savings_diram FROM product_events WHERE session_id = $1',
        [sessionId],
      )
      expect(rows.rows).toEqual([{ savings_diram: null }])
      await close()
    },
    FULL_BOOT_TIMEOUT_MS,
  )

  it(
    'АС4: analog_shown → заказ этого аналога в той же сессии — реализованная экономия равна серверному значению',
    async () => {
      fakeOfferLookup = new FakeAnalogOfferLookupAdapter()
      const { batchUseCase, realizedSavings, close } = await bootModule()
      fakeOfferLookup.setOffers(referenceId, [offer('pharm-ref', 6000)])
      fakeOfferLookup.setOffers(analogId, [offer('pharm-analog', 1000)])
      const sessionId = `session-${randomUUID()}`

      await batchUseCase.execute({
        tenantId,
        userId: null,
        events: [
          {
            eventType: 'analog_shown',
            sessionId,
            referenceMedicineId: referenceId,
            medicineId: analogId,
            savingsDiram: 999_999_999n, // клиентская попытка накрутки — должна быть проигнорирована
          },
        ],
      })

      const result = await realizedSavings.calculate({
        orderId: randomUUID(),
        orderItems: [{ medicineId: analogId }],
        tenantId,
        sessionId,
      })

      expect(result).toBe(5000n)
      await close()
    },
    FULL_BOOT_TIMEOUT_MS,
  )
})
