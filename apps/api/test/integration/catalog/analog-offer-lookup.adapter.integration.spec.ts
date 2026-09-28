/**
 * Интеграционный тест `AnalogOfferLookupAdapter`/`InventoryFacade.getOffersForMedicines`
 * (DTJ-439) — РЕАЛЬНЫЙ Postgres, критерии приёмки 1/2 буквально + `AnalogOfferLookupPort`
 * контракт (сортировка по цене, только медикаменты с офферами В РАДИУСЕ).
 *
 * `InventoryFacade` сконструирован напрямую (`new`), без `NestApplication` — тот же приём,
 * что `postgres-search.adapter.integration.spec.ts` для `PostgresSearchProvider`. Остальные
 * зависимости фасада (`PHARMACY_INVENTORY_REPOSITORY`, use case'ы ключей 1С) этому методу не
 * нужны — заглушки `{} as ...`.
 *
 * @see tickets/ep03-catalog-analogs/DTJ-439.md
 */
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { InventoryFacade } from '@/modules/inventory/inventory.facade.js'
import type { PharmacyInventoryRepository } from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'
import type { InventorySyncBatchRepository } from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'
import type { CreatePharmacyApiKeyUseCase } from '@/modules/inventory/application/use-cases/create-pharmacy-api-key.use-case.js'
import type { ListPharmacyApiKeysUseCase } from '@/modules/inventory/application/use-cases/list-pharmacy-api-keys.use-case.js'
import type { RevokePharmacyApiKeyUseCase } from '@/modules/inventory/application/use-cases/revoke-pharmacy-api-key.use-case.js'
import type { RotatePharmacyApiKeyUseCase } from '@/modules/inventory/application/use-cases/rotate-pharmacy-api-key.use-case.js'
import type { SetPharmacyApiKeyMtlsUseCase } from '@/modules/inventory/application/use-cases/set-pharmacy-api-key-mtls.use-case.js'
import type { RevokeExpiredRotatedKeyUseCase } from '@/modules/inventory/application/use-cases/revoke-expired-rotated-key.use-case.js'

const TEST_DATABASE_URL =
  process.env.CATALOG_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const MIGRATOR_DATABASE_URL = process.env.CATALOG_MIGRATOR_DATABASE_URL ?? buildMigratorUrl(TEST_DATABASE_URL)

function buildMigratorUrl(appUrl: string): string {
  try {
    const url = new URL(appUrl)
    url.username = 'dorutj_migrator'
    url.password = 'dorutj_dev_only_password' // Дев-дефолт, не секрет (правило 13 AGENTS.md).
    return url.toString()
  } catch {
    return appUrl
  }
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations/', import.meta.url))
const PROBE_TIMEOUT_MS = 1_500
const CHAIN_ACTIVE = '00000000-0000-4000-8000-0000000000f1'
const CHAIN_SUSPENDED = '00000000-0000-4000-8000-0000000000f2'
const PHARMACY_IN_RADIUS = '00000000-0000-4000-8000-0000000000f3'
const PHARMACY_OUT_OF_RADIUS = '00000000-0000-4000-8000-0000000000f4'
const PHARMACY_INACTIVE = '00000000-0000-4000-8000-0000000000f5'
const PHARMACY_SUSPENDED_CHAIN = '00000000-0000-4000-8000-0000000000f6'
const CATEGORY_ID = 1
const REFERENCE_ID = '00000000-0000-4000-8000-0000000000f7'
const GENERIC_ID = '00000000-0000-4000-8000-0000000000f8'
const NO_STOCK_IN_RADIUS_ID = '00000000-0000-4000-8000-0000000000f9'
const CENTER = { lat: 38.55, lon: 68.78 } // Душанбе, тот же центр, что postgres-search.adapter.integration.spec.ts
const FAR_AWAY = { lat: 39.2, lon: 69.6 } // ~90км от CENTER — вне радиуса 5000м

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

function buildFacade(db: NodePgDatabase): InventoryFacade {
  return new InventoryFacade(
    {} as PharmacyInventoryRepository,
    { now: () => new Date('2026-09-28T12:00:00Z') },
    {} as InventorySyncBatchRepository,
    {} as CreatePharmacyApiKeyUseCase,
    {} as ListPharmacyApiKeysUseCase,
    {} as RevokePharmacyApiKeyUseCase,
    {} as RotatePharmacyApiKeyUseCase,
    {} as SetPharmacyApiKeyMtlsUseCase,
    {} as RevokeExpiredRotatedKeyUseCase,
    db,
  )
}

describe.skipIf(!postgresAvailable || !migratorAvailable)('InventoryFacade.getOffersForMedicines — integration (DTJ-439)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let migratorPool: Pool
  let facade: InventoryFacade

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    migratorPool = new Pool({ connectionString: MIGRATOR_DATABASE_URL })
    await migrate(drizzle(migratorPool), { migrationsFolder: MIGRATIONS_DIR })
    facade = buildFacade(db)
  })

  afterAll(async () => {
    await migratorPool.end().catch(() => undefined)
    await pool.end().catch(() => undefined)
  })

  async function truncateAll(): Promise<void> {
    await migratorPool.query(
      'TRUNCATE pharmacy_inventory, pharmacies, pharmacy_chains, medicine_substances, medicines, categories RESTART IDENTITY CASCADE',
    )
  }

  // Офферный запрос facade не читает tenants/pharmacy_chains.tenant_id (порт не передаёт
  // tenantId, см. JSDoc AnalogOfferLookupInput) — тенанта не сеем, он не нужен.
  async function seedBaseFixtures(): Promise<void> {
    await pool.query(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('root-dtj439', 'Корень', 'Root', 'Root', 'otc', 0, true)`,
    )
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status, tenant_id)
       VALUES ($1, 'Сеть активна', 'ООО Сеть 1', '000000439', 'active', NULL),
              ($2, 'Сеть приостановлена', 'ООО Сеть 2', '000000440', 'suspended', NULL)`,
      [CHAIN_ACTIVE, CHAIN_SUSPENDED],
    )
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES
         ($1, $5, 'В радиусе', 'ул. 1', $2, $3, '+992900000001', 'active'),
         ($4, $5, 'Далеко', 'ул. 2', $6, $7, '+992900000002', 'active'),
         ($8, $5, 'Неактивна', 'ул. 3', $2, $3, '+992900000003', 'suspended'),
         ($9, $10, 'Сеть неактивна', 'ул. 4', $2, $3, '+992900000004', 'active')`,
      [
        PHARMACY_IN_RADIUS,
        CENTER.lat,
        CENTER.lon,
        PHARMACY_OUT_OF_RADIUS,
        CHAIN_ACTIVE,
        FAR_AWAY.lat,
        FAR_AWAY.lon,
        PHARMACY_INACTIVE,
        PHARMACY_SUSPENDED_CHAIN,
        CHAIN_SUSPENDED,
      ],
    )
  }

  async function seedMedicine(id: string, tradeName: string): Promise<void> {
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, true)`,
      [id, tradeName, `INN-${tradeName}`, CATEGORY_ID],
    )
  }

  beforeEach(async () => {
    await truncateAll()
    await seedBaseFixtures()
    await seedMedicine(REFERENCE_ID, 'Reference-DTJ439')
    await seedMedicine(GENERIC_ID, 'Generic-DTJ439')
    await seedMedicine(NO_STOCK_IN_RADIUS_ID, 'NoStockInRadius-DTJ439')
  })

  it('AC1: два дженерика с ценами, отсортированы по цене ASC, в радиусе от CENTER', async () => {
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $2, 3000, 10, CURRENT_DATE + INTERVAL '1 year'),
              ($1, $3, 1800, 5, CURRENT_DATE + INTERVAL '1 year')`,
      [PHARMACY_IN_RADIUS, REFERENCE_ID, GENERIC_ID],
    )

    const result = await facade.getOffersForMedicines({
      medicineIds: [REFERENCE_ID, GENERIC_ID],
      geo: CENTER,
      radiusMeters: 5000,
    })

    const referenceOffers = result.get(REFERENCE_ID) ?? []
    const genericOffers = result.get(GENERIC_ID) ?? []
    expect(referenceOffers).toHaveLength(1)
    expect(genericOffers).toHaveLength(1)
    const [referenceOffer] = referenceOffers
    const [genericOffer] = genericOffers
    expect(referenceOffer).toMatchObject({ priceDiram: 3000, pharmacyId: PHARMACY_IN_RADIUS })
    expect(genericOffer).toMatchObject({ priceDiram: 1800 })
    // savings — DTJ-385 (computeAnalogSavingsDiram), вне этого адаптера — проверяем, что
    // разница цен сида совпадает с ожидаемой экономией.
    const savingsDiram = (referenceOffer?.priceDiram ?? 0) - (genericOffer?.priceDiram ?? 0)
    expect(savingsDiram).toBe(1200)
  })

  it('несколько офферов на медикамент отсортированы по цене ASC (SRS-DOM-158)', async () => {
    const secondPharmacyId = '00000000-0000-4000-8000-0000000000fa'
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, 'Вторая в радиусе', 'ул. 5', $3, $4, '+992900000005', 'active')`,
      [secondPharmacyId, CHAIN_ACTIVE, CENTER.lat, CENTER.lon],
    )
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $3, 2500, 4, CURRENT_DATE + INTERVAL '1 year'),
              ($2, $3, 1200, 3, CURRENT_DATE + INTERVAL '1 year')`,
      [PHARMACY_IN_RADIUS, secondPharmacyId, GENERIC_ID],
    )

    const result = await facade.getOffersForMedicines({
      medicineIds: [GENERIC_ID],
      geo: CENTER,
      radiusMeters: 5000,
    })

    const offers = result.get(GENERIC_ID)
    expect(offers?.map((o) => o.priceDiram)).toEqual([1200, 2500])
  })

  it('AC2 (SRS-CAT-045): медикамент без остатка В РАДИУСЕ не показывается', async () => {
    // Единственный оффер — далеко от CENTER (вне радиуса 5000м).
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $2, 1000, 10, CURRENT_DATE + INTERVAL '1 year')`,
      [PHARMACY_OUT_OF_RADIUS, NO_STOCK_IN_RADIUS_ID],
    )

    const result = await facade.getOffersForMedicines({
      medicineIds: [NO_STOCK_IN_RADIUS_ID],
      geo: CENTER,
      radiusMeters: 5000,
    })

    expect(result.has(NO_STOCK_IN_RADIUS_ID)).toBe(false)
  })

  it('quantity=0 не считается доступным оффером', async () => {
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $2, 1000, 0, CURRENT_DATE + INTERVAL '1 year')`,
      [PHARMACY_IN_RADIUS, NO_STOCK_IN_RADIUS_ID],
    )

    const result = await facade.getOffersForMedicines({
      medicineIds: [NO_STOCK_IN_RADIUS_ID],
      geo: CENTER,
      radiusMeters: 5000,
    })

    expect(result.has(NO_STOCK_IN_RADIUS_ID)).toBe(false)
  })

  it('неактивная аптека и приостановленная сеть не участвуют (SRS-CAT-010)', async () => {
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $3, 1000, 10, CURRENT_DATE + INTERVAL '1 year'),
              ($2, $3, 1000, 10, CURRENT_DATE + INTERVAL '1 year')`,
      [PHARMACY_INACTIVE, PHARMACY_SUSPENDED_CHAIN, NO_STOCK_IN_RADIUS_ID],
    )

    const result = await facade.getOffersForMedicines({
      medicineIds: [NO_STOCK_IN_RADIUS_ID],
      geo: CENTER,
      radiusMeters: 5000,
    })

    expect(result.has(NO_STOCK_IN_RADIUS_ID)).toBe(false)
  })

  it('без geo — офферы возвращаются без фильтра дистанции, distanceMeters=null', async () => {
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $2, 1000, 10, CURRENT_DATE + INTERVAL '1 year')`,
      [PHARMACY_OUT_OF_RADIUS, REFERENCE_ID],
    )

    const result = await facade.getOffersForMedicines({ medicineIds: [REFERENCE_ID], radiusMeters: 5000 })

    const offers = result.get(REFERENCE_ID)
    expect(offers).toHaveLength(1)
    expect(offers?.[0]?.distanceMeters).toBeNull()
  })
})
