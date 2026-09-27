/**
 * Интеграционный тест `PostgresPharmacyMapAdapter.findPinsInBbox()` (DEFECT-FIX, DTJ-195
 * постмортем) — РЕАЛЬНЫЙ Postgres, реальный адаптер (НЕ фейк-репозиторий).
 *
 * **Почему этот файл существует.** `pharmacies-map-controller.integration.spec.ts` (DTJ-197)
 * подменяет `PHARMACY_MAP_REPOSITORY` in-memory фейком (см. его собственный JSDoc: «никакой
 * БД») — ни один тест до этого файла не выполнял SQL адаптера на настоящем Postgres. Именно
 * поэтому дефект `ph.geo_point && ST_MakeEnvelope(...)` (колонка/расширение PostGIS не
 * существуют — `type "geometry" does not exist`) остался незамеченным всеми зелёными воротами.
 * Этот файл бьёт напрямую в `PostgresPharmacyMapAdapter` через реальное соединение — тот же
 * приём раннера миграций/фикстур, что `postgres-search.adapter.integration.spec.ts` (DTJ-185).
 *
 * **Изоляция от соседних файлов (Ж-требование сдачи).** `dorutj_test` делят все интеграционные
 * спеки `test/integration/catalog/*`, и `postgres-search.adapter.integration.spec.ts` делает
 * `TRUNCATE ... tenants ... CASCADE` в своём `beforeEach`. Эта фикстура НЕ полагается на строку
 * нейтрального тенанта из миграции `0021_seed_neutral_tenant.sql` (она может быть смыта чужим
 * TRUNCATE до или после этого файла) — заводит СОБСТВЕННЫЙ White-Label тенант/сеть/аптеки под
 * своими фиксированными UUID и НЕ трогает глобальную таблицу `tenants` целиком (только удаляет
 * И заново вставляет СВОЮ строку через `ON CONFLICT (id) DO UPDATE`), поэтому не зависит от
 * порядка запуска файлов и не портит фикстуры соседей.
 *
 * Сценарии:
 *   1. Аптека строго ВНУТРИ bbox попадает в результат.
 *   2. Аптека строго ЗА границей bbox (широта вне диапазона) НЕ попадает — единственный способ
 *      отличить работающий диапазонный фильтр от его полного отсутствия (SQL-ошибка/no-op).
 *   3. Аптека строго ЗА границей bbox (долгота вне диапазона) НЕ попадает — тот же довод по
 *      второй координате отдельно.
 *   4. `lat`/`lon` в ответе — JS `number`, не строка (`numeric(10,8)`/`numeric(11,8)` без явного
 *      `::double precision` отдаются драйвером `pg` строкой — тот же класс дефекта, что был
 *      здесь с `geo_point`).
 *   5. `medicineId` передан — оффер (цена/остаток) подтягивается по реальным `pharmacy_inventory`
 *      join'ам (доказывает, что не только bbox, но и весь адаптер целиком отрабатывает на живой
 *      схеме после фикса).
 *
 * Фикстура идемпотентна (`ON CONFLICT ... DO UPDATE`/`TRUNCATE` только СВОИХ строк) — сьют
 * проходит одинаково при повторном запуске без пересоздания БД (Ж-требование сдачи).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-052..054)
 * @see apps/api/src/modules/catalog/infrastructure/adapters/postgres-pharmacy-map.adapter.ts
 */
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { PostgresPharmacyMapAdapter } from '@/modules/catalog/infrastructure/adapters/postgres-pharmacy-map.adapter.js'
import { TenantId } from '@/modules/tenancy/index.js'
import type { BboxQuery } from '@/modules/catalog/application/pharmacies-map/ports/pharmacy-map-repository.port.js'
import type { Clock } from '@/shared-kernel/index.js'

const TEST_DATABASE_URL =
  process.env.CATALOG_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

/**
 * ИСПРАВЛЕНО (гейт CI): `migrate()` под ролью `test` падает `permission denied for schema
 * drizzle`, когда реальные миграции уже применены `dorutj_migrator` (см. JSDoc
 * `postgres-search.adapter.integration.spec.ts`, тот же приём здесь) — DDL под ОТДЕЛЬНЫМ
 * `migratorPool`, `db`/`pool` (`test`) остаются для самого теста.
 */
const MIGRATOR_DATABASE_URL = process.env.CATALOG_MIGRATOR_DATABASE_URL ?? buildMigratorUrl(TEST_DATABASE_URL)

function buildMigratorUrl(appUrl: string): string {
  try {
    const url = new URL(appUrl)
    url.username = 'dorutj_migrator'
    url.password = 'dorutj_dev_only_password'
    return url.toString()
  } catch {
    return appUrl
  }
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations/', import.meta.url))
const PROBE_TIMEOUT_MS = 1_500

// Фиксированные UUID этого файла — namespace `...-4000-8000-00000000AAxx`, не пересекается
// ни с одним ID в соседних фикстурах `test/integration/catalog/*` (проверено grep'ом).
const TENANT_ID = '00000000-0000-4000-8000-0000000000a1'
const CHAIN_ID = '00000000-0000-4000-8000-0000000000a2'
const PHARMACY_INSIDE_ID = '00000000-0000-4000-8000-0000000000a3'
const PHARMACY_OUTSIDE_LAT_ID = '00000000-0000-4000-8000-0000000000a4'
const PHARMACY_OUTSIDE_LON_ID = '00000000-0000-4000-8000-0000000000a5'
const MEDICINE_ID = '00000000-0000-4000-8000-0000000000a6'
const CATEGORY_ID = 900001

/** bbox видимой области — прямоугольник ~1км² в центре Душанбе. */
const BBOX = { lonMin: 68.78, latMin: 38.55, lonMax: 68.79, latMax: 38.56 }
/** Строго внутри BBOX. */
const INSIDE = { lat: 38.555, lon: 68.785 }
/** Широта СТРОГО выше latMax — остальное внутри диапазона долготы. */
const OUTSIDE_LAT = { lat: 38.61, lon: 68.785 }
/** Долгота СТРОГО правее lonMax — остальное внутри диапазона широты. */
const OUTSIDE_LON = { lat: 38.555, lon: 68.83 }

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

const FIXED_CLOCK: Clock = { now: () => new Date('2026-01-01T00:00:00.000Z') }

function baseQuery(overrides: Partial<BboxQuery> = {}): BboxQuery {
  return {
    lonMin: BBOX.lonMin,
    latMin: BBOX.latMin,
    lonMax: BBOX.lonMax,
    latMax: BBOX.latMax,
    tenantId: TenantId.from(TENANT_ID),
    ...overrides,
  }
}

describe.skipIf(!postgresAvailable || !migratorAvailable)('PostgresPharmacyMapAdapter.findPinsInBbox() — integration (DEFECT-FIX)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let migratorPool: Pool
  let adapter: PostgresPharmacyMapAdapter

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    migratorPool = new Pool({ connectionString: MIGRATOR_DATABASE_URL })
    // DDL — под ролью-владельцем `dorutj_migrator` (см. блок «ИСПРАВЛЕНО» в шапке файла).
    await migrate(drizzle(migratorPool), { migrationsFolder: MIGRATIONS_DIR })
    adapter = new PostgresPharmacyMapAdapter(db, FIXED_CLOCK)
  })

  afterAll(async () => {
    await migratorPool.end().catch(() => undefined)
    await pool.end().catch(() => undefined)
  })

  /** Удаляет ТОЛЬКО строки этого файла — не трогает соседние фикстуры (см. JSDoc файла). */
  async function cleanupOwnRows(): Promise<void> {
    await pool.query('DELETE FROM pharmacy_inventory WHERE pharmacy_id = ANY($1::uuid[])', [
      [PHARMACY_INSIDE_ID, PHARMACY_OUTSIDE_LAT_ID, PHARMACY_OUTSIDE_LON_ID],
    ])
    await pool.query('DELETE FROM pharmacies WHERE id = ANY($1::uuid[])', [
      [PHARMACY_INSIDE_ID, PHARMACY_OUTSIDE_LAT_ID, PHARMACY_OUTSIDE_LON_ID],
    ])
    await pool.query('DELETE FROM medicines WHERE id = $1', [MEDICINE_ID])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
    await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [CHAIN_ID])
    await pool.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [TENANT_ID])
    await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
  }

  async function seedTenantAndChain(): Promise<void> {
    // White-Label тенант — pharmacy_chains.tenant_id = tenants.id закрывает
    // visibilityAndTenantScopeFragment() напрямую, без зависимости на нейтральный fallback
    // (см. JSDoc файла — не трогаем общую строку нейтрального тенанта соседних фикстур).
    await pool.query(
      `INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, 'defect-fix-map-test', false)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, is_neutral = EXCLUDED.is_neutral`,
      [TENANT_ID],
    )
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status, tenant_id)
       VALUES ($1, 'Сеть DEFECT-FIX', 'ООО Сеть DEFECT-FIX', '900000001', 'active', $2)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, tenant_id = EXCLUDED.tenant_id`,
      [CHAIN_ID, TENANT_ID],
    )
    // buildPinsWithOfferQuery делает INNER JOIN tenant_settings — обязателен для сценария 5
    // (medicineId передан). Остальные колонки берут дефолты схемы (`tenants.ts`).
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, brand_name) VALUES ($1, 'DEFECT-FIX Test')
       ON CONFLICT (tenant_id) DO UPDATE SET brand_name = EXCLUDED.brand_name`,
      [TENANT_ID],
    )
  }

  async function seedPharmacy(id: string, coords: { readonly lat: number; readonly lon: number }): Promise<void> {
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status, is_24_7)
       VALUES ($1, $2, 'Аптека DEFECT-FIX', 'ул. Тестовая', $3, $4, '+992900000000', 'active', true)`,
      [id, CHAIN_ID, coords.lat, coords.lon],
    )
  }

  beforeEach(async () => {
    await cleanupOwnRows()
    await seedTenantAndChain()
  })

  afterEach(async () => {
    await cleanupOwnRows()
  })

  it('1+2+3. bbox: включает строго внутреннюю аптеку, исключает аптеки за границей по каждой координате отдельно', async () => {
    await seedPharmacy(PHARMACY_INSIDE_ID, INSIDE)
    await seedPharmacy(PHARMACY_OUTSIDE_LAT_ID, OUTSIDE_LAT)
    await seedPharmacy(PHARMACY_OUTSIDE_LON_ID, OUTSIDE_LON)

    const pins = await adapter.findPinsInBbox(baseQuery())

    const ids = pins.map((pin) => pin.pharmacyId)
    expect(ids).toContain(PHARMACY_INSIDE_ID)
    expect(ids).not.toContain(PHARMACY_OUTSIDE_LAT_ID)
    expect(ids).not.toContain(PHARMACY_OUTSIDE_LON_ID)
    expect(ids).toHaveLength(1)
  })

  it('4. DEFECT-FIX: lat/lon — JS number, не строка (numeric без явного каста отдаётся driver-ом строкой)', async () => {
    await seedPharmacy(PHARMACY_INSIDE_ID, INSIDE)

    const pins = await adapter.findPinsInBbox(baseQuery())
    const pin = pins[0]
    if (pin === undefined) throw new Error('ожидался хотя бы один пин')

    expect(typeof pin.lat).toBe('number')
    expect(typeof pin.lon).toBe('number')
    expect(pin.lat).toBeCloseTo(INSIDE.lat, 6)
    expect(pin.lon).toBeCloseTo(INSIDE.lon, 6)
  })

  it('5. medicineId передан: оффер подтягивается по реальным pharmacy_inventory join-ам', async () => {
    await seedPharmacy(PHARMACY_INSIDE_ID, INSIDE)
    await pool.query(
      `INSERT INTO categories (id, slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ($1, 'defect-fix-map-test', 'Категория', 'Категория', 'Category', 'otc', 0, true)
       ON CONFLICT (id) DO NOTHING`,
      [CATEGORY_ID],
    )
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, 'Тест-Медикамент', 'test-inn', $2, 'таблетки', 'tablet', '500 мг',
               'Tajikistan', 'Test Pharma', false, 'none', true, false, true)
       ON CONFLICT (id) DO NOTHING`,
      [MEDICINE_ID, CATEGORY_ID],
    )
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $2, 1250, 7, CURRENT_DATE + INTERVAL '1 year')`,
      [PHARMACY_INSIDE_ID, MEDICINE_ID],
    )

    const pins = await adapter.findPinsInBbox(baseQuery({ medicineId: MEDICINE_ID }))
    const pin = pins.find((candidate) => candidate.pharmacyId === PHARMACY_INSIDE_ID)
    if (pin === undefined) throw new Error('ожидался пин искомой аптеки')

    expect(pin.offer).not.toBeNull()
    expect(pin.offer?.priceDiram).toBe(1250)
    expect(pin.offer?.stockQuantity).toBe(7)
    expect(pin.offer?.isStale).toBe(false)
  })
})
