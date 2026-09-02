/**
 * Drizzle-реализация `PharmacyMapRepository` (DTJ-195, EP-08 — Карта аптек, R1-6).
 *
 * bbox-запрос пинов аптек видимой области карты (`SRS-CAT-052`/`SRS-CAT-053`) — принципиально
 * ОТДЕЛЬНЫЙ путь от гаверсинус-поиска (DTJ-185): bbox — прямоугольник, выражается обычным
 * диапазонным сравнением `latitude BETWEEN ... AND longitude BETWEEN ...`, без ранжирования.
 *
 * **DEFECT-FIX (пост-мортем, см. отчёт сдачи): `geo_point`/PostGIS не существуют, фильтр
 * переведён на `latitude`/`longitude`.** Первая версия этого файла (DTJ-195) была написана
 * «по целевой схеме» — `ph.geo_point && ST_MakeEnvelope(...)` (GiST `&&`) — и падала на живой
 * БД с `type "geometry" does not exist`: колонки `geo_point` НЕТ ни в одной миграции
 * (`apps/api/migrations/`), расширение `postgis` НЕ установлено (`pg_extension`), и образ
 * `postgres:16` его даже не может поставить (`pg_available_extensions` — 0 строк для
 * `postgis%`). Дефект был невидим, потому что `pharmacies-map-controller.integration.spec.ts`
 * подменяет `PHARMACY_MAP_REPOSITORY` фейком — ни один тест не выполнял этот SQL на реальном
 * Postgres (закрыто здесь, см. `postgres-pharmacy-map.adapter.integration.spec.ts`).
 *
 * Решение — то же самое, что уже принято в этом модуле для DTJ-185
 * (`postgres-search.sql.ts`, JSDoc п.1: гаверсинус на `latitude`/`longitude` вместо
 * `ST_DWithin`): bbox не нуждается в GiST/geometry вообще — это диапазон, а не радиус.
 * `ix_pharmacies_lat_lon` (обычный составной btree, миграция `0022_pharmacies_lat_lon_index.sql`)
 * покрывает диапазонный предикат. **`numeric`-ловушка**: `latitude`/`longitude` — `numeric(10,8)`/
 * `numeric(11,8)`, драйвер `pg` без явного приведения отдаёт `numeric` СТРОКОЙ — `lon`/`lat` в
 * SELECT приводятся к `::double precision`, иначе `PharmacyMapPin.lat`/`.lon` ушли бы во фронт
 * строками (`"38.5"` вместо `38.5`) — тот же класс дефекта, что был здесь с geo_point.
 *
 * **Обоснование прямого JOIN чужих bounded contexts (аналогично DTJ-185, `SRS-CAT-014`).**
 * Этот адаптер джойнит `pharmacy_chains`/`pharmacy_inventory` (`onboarding`/`inventory`) и
 * `tenants`/`tenant_settings` (`tenancy`) напрямую из `catalog`-инфраструктуры, минуя чужие
 * фасады — карта, как и поиск, требует одного SQL-прохода по геоиндексу с одновременной
 * проверкой видимости сети/тенанта и (опционально) цены/остатка ОДНОГО медикамента; проведение
 * этого через `OrdersFacade`-подобные фасады означало бы N+1 запросов на страницу карты.
 *
 * **ВАЖНО — два оставшихся расхождения между текстом тикета/спецификацией и фактическим
 * состоянием репозитория на момент реализации (детали — в отчёте сдачи DTJ-195, раздел
 * «Найденные чужие проблемы»); НЕ исправлены здесь молча, т.к. требуют правки файлов вне
 * `files_owned` этого тикета (п.1 из исходного списка — `geo_point`/PostGIS — закрыт выше):**
 *
 * 1. **`PharmacyMapPin` (порт DTJ-194) объявляет уже ВЫЧИСЛЕННЫЙ `isOpenNow: boolean` и НЕ несёт
 *    сырых `openingTime`/`closingTime`**, хотя текст ЭТОГО тикета прямо требует возвращать сырые
 *    поля и НЕ вычислять `isOpenNow` здесь (см. Definition of Done тикета) — вычисление должен
 *    делать `GetPharmacyMapPinsUseCase` (DTJ-196) через `PharmacyOpeningHoursPolicy` (DTJ-184).
 *    Ни DTJ-184, ни исправление порта DTJ-194 недоступны на момент этого тикета. Чтобы вернуть
 *    компилируемый, работающий адаптер, соответствующий ФАКТИЧЕСКОМУ контракту порта,
 *    `isOpenNow` вычисляется здесь ВРЕМЕННО — детерминированно через уже существующий `ClockPort`
 *    (`@/shared-kernel`, НЕ `Date.now()`) и дословно алгоритм `SRS-CAT-046`, см. `computeIsOpenNow`
 *    ниже. Это ЗНАЕТ дублирование с будущей `PharmacyOpeningHoursPolicy` — технический долг,
 *    подлежащий удалению, когда порт DTJ-194 будет скорректирован (добавит сырые поля).
 * 2. **`pharmacy_inventory` не имеет колонки `last_synced_at`** (только `updated_at`), хотя
 *    `docs/spec/11-database-schema.md` её специфицирует и текст тикета явно ссылается на неё.
 *    `updated_at` используется как ближайший практический эквивалент для `offer.lastSyncedAt`/
 *    `isStale` — обновляется при каждой записи остатка/цены (1С/Excel/ручной ввод), что на
 *    практике соответствует смыслу «последней синхронизации», но НЕ идентично колонке из спеки.
 *
 * **Скоуп по тенанту (`SRS-DB-025..028`, `SRS-TEN-003`).** `pharmacies` не несёт `tenant_id`
 * напрямую — тенант выводится транзитивно через `pharmacy_chains.tenant_id`. Обычная (не
 * White-Label) сеть НЕ получает строку `tenants` вообще и продаётся через нейтральный маркетплейс
 * (`pharmacy_chains.tenant_id IS NULL`); White-Label сеть видна ИСКЛЮЧИТЕЛЬНО на витрине своего
 * тенанта (`pharmacy_chains.tenant_id = :tenantId`). Наивное равенство `pc.tenant_id = :tenantId`
 * без учёта нейтрального случая вернуло бы ноль аптек на нейтральной витрине — используется
 * условие `pc.tenant_id = t.id OR (t.is_neutral AND pc.tenant_id IS NULL)`. ASSUMPTION: это
 * прочтение `26-module-tenancy-whitelabel.md` §2/`SRS-TEN-003`, ни ticket DTJ-195, ни
 * `docs/spec/20-module-catalog-search.md` не показывают tenant-фильтр в примерах SQL явно —
 * нужен отдельный CTO-ревью этого решения (см. отчёт сдачи).
 *
 * **Рубеж видимости сети/аптеки** (`ph.status='active' AND pc.status IN ('approved','active')`)
 * написан ЛОКАЛЬНО, т.к. `postgres-search.adapter.ts` (DTJ-185) на момент этого тикета ещё не
 * реализован — переиспользуемого строителя нет. `visibilityAndTenantScopeFragment()` ниже —
 * кандидат на выделение в общий модуль при появлении DTJ-185 (см. риски тикета DTJ-195).
 *
 * **Unit vs integration.** `postgres-pharmacy-map.adapter.spec.ts` — форма SQL/маппинг на моке
 * `DrizzleDb` (тот же приём, что `analog-candidates.adapter.spec.ts`, DTJ-100). Реальная
 * семантика фильтра — bbox включение/исключение на границе, suspended-сеть, narcotic, вырезание
 * numeric-строк — проверяется `postgres-pharmacy-map.adapter.integration.spec.ts` на реальном
 * Postgres (тот же паттерн раннера миграций/фикстур, что `postgres-search.adapter.integration.spec.ts`,
 * DTJ-185); `EXPLAIN`/GiST не применимы — обычный btree-диапазон, не геоиндекс.
 */
import { Inject, Injectable } from '@nestjs/common'
import { sql, type SQL } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { pharmacyChains } from '@/db/schema/pharmacy-chains.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import { medicines } from '@/db/schema/medicines.js'
import { tenants, tenantSettings } from '@/db/schema/tenants.js'
import {
  PHARMACY_MAP_REPOSITORY,
  type BboxQuery,
  type PharmacyMapPin,
  type PharmacyMapRepository,
} from '@/modules/catalog/application/pharmacies-map/ports/pharmacy-map-repository.port.js'

/** SRS-CAT-061: клиент кластеризует визуально при зуме, сервер не пагинирует пины. */
const PIN_LIMIT = 500
/** SRS-CAT-052/§7.5: тот же множитель "устаревания", что и в поиске. */
const STALE_THRESHOLD_MULTIPLIER = 3
/** Asia/Dushanbe = UTC+5 круглый год, без перехода на летнее время (DTJ-184, риски). */
const DUSHANBE_UTC_OFFSET_HOURS = 5
const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000

/** Сырая форма строки результата (общая для обеих SQL-веток — offer-поля `null`, когда не запрошены). */
interface PinRow {
  readonly pharmacyId: string
  readonly name: string
  readonly lon: number
  readonly lat: number
  readonly is24x7: boolean
  readonly openingTime: string | null
  readonly closingTime: string | null
  readonly priceDiram: number | null
  readonly stockQuantity: number | null
  readonly updatedAt: Date | string | null
  readonly inventoryDeltaSlaMinutes: number | null
}

@Injectable()
export class PostgresPharmacyMapAdapter implements PharmacyMapRepository {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async findPinsInBbox(query: BboxQuery): Promise<readonly PharmacyMapPin[]> {
    const sqlQuery =
      query.medicineId === undefined
        ? buildPinsQuery(query)
        : buildPinsWithOfferQuery(query, query.medicineId)
    const rows = extractRows(await this.db.execute(sqlQuery))
    const now = this.clock.now()
    return rows.map((row) => mapRowToPin(row, now))
  }
}

/** DI-привязка: провайдер для `PHARMACY_MAP_REPOSITORY` (D-27). */
export const PHARMACY_MAP_REPOSITORY_PROVIDER = {
  provide: PHARMACY_MAP_REPOSITORY,
  useClass: PostgresPharmacyMapAdapter,
} as const

// ─── SQL: видимость и tenant-скоуп (см. JSDoc файла) ─────────────────────────────────

// TODO(DTJ-185): вынести в общий переиспользуемый строитель условия видимости сети/аптеки,
// когда появится postgres-search.adapter.ts — см. риски тикета DTJ-195.
function visibilityAndTenantScopeFragment(): SQL {
  return sql`
    ${pharmacies.status} = 'active'
    AND (${pharmacyChains.tenantId} = ${tenants.id} OR (${tenants.isNeutral} AND ${pharmacyChains.tenantId} IS NULL))
  `
}

/**
 * bbox = диапазон, не радиус — обычное `BETWEEN` по `latitude`/`longitude` (см. JSDoc файла,
 * DEFECT-FIX): не нуждается в GiST/geometry, `ix_pharmacies_lat_lon` (btree,
 * `0022_pharmacies_lat_lon_index.sql`) покрывает оба диапазона.
 */
function bboxFilterFragment(query: BboxQuery): SQL {
  return sql`${pharmacies.latitude} BETWEEN ${query.latMin} AND ${query.latMax}
    AND ${pharmacies.longitude} BETWEEN ${query.lonMin} AND ${query.lonMax}`
}

function buildPinsQuery(query: BboxQuery): SQL {
  return sql`
    SELECT
      ${pharmacies.id} AS "pharmacyId",
      ${pharmacies.name} AS "name",
      ${pharmacies.longitude}::double precision AS "lon",
      ${pharmacies.latitude}::double precision AS "lat",
      ${pharmacies.is24_7} AS "is24x7",
      ${pharmacies.openingTime} AS "openingTime",
      ${pharmacies.closingTime} AS "closingTime"
    FROM ${pharmacies}
    JOIN ${pharmacyChains} ON ${pharmacyChains.id} = ${pharmacies.chainId} AND ${pharmacyChains.status} IN ('approved', 'active')
    JOIN ${tenants} ON ${tenants.id} = ${query.tenantId.value}
    WHERE ${visibilityAndTenantScopeFragment()}
      AND ${bboxFilterFragment(query)}
    LIMIT ${PIN_LIMIT}
  `
}

/**
 * `medicineId` присутствует (SRS-CAT-052 п.2). `JOIN medicines ON medicines.id = :medicineId AND
 * control_category NOT IN (...)` — рубеж defense-in-depth (SRS-CAT-055): если медикамент
 * запрещённой категории, LATERAL не вернёт строк ни для одной аптеки НЕЗАВИСИМО от остатка
 * (критерий приёмки 5 тикета DTJ-195).
 */
function offerLateralFragment(medicineId: string): SQL {
  return sql`
    LEFT JOIN LATERAL (
      SELECT ${pharmacyInventory.price}, ${pharmacyInventory.quantity}, ${pharmacyInventory.updatedAt}
      FROM ${pharmacyInventory}
      JOIN ${medicines} ON ${medicines.id} = ${medicineId} AND ${medicines.controlCategory} NOT IN ('psychotropic', 'narcotic')
      WHERE ${pharmacyInventory.pharmacyId} = pharmacies.id
        AND ${pharmacyInventory.medicineId} = ${medicineId}
        AND ${pharmacyInventory.quantity} > 0
      ORDER BY ${pharmacyInventory.price} ASC
      LIMIT 1
    ) offer ON true
  `
}

function buildPinsWithOfferQuery(query: BboxQuery, medicineId: string): SQL {
  return sql`
    SELECT
      ${pharmacies.id} AS "pharmacyId",
      ${pharmacies.name} AS "name",
      ${pharmacies.longitude}::double precision AS "lon",
      ${pharmacies.latitude}::double precision AS "lat",
      ${pharmacies.is24_7} AS "is24x7",
      ${pharmacies.openingTime} AS "openingTime",
      ${pharmacies.closingTime} AS "closingTime",
      offer.price AS "priceDiram",
      offer.quantity AS "stockQuantity",
      offer.updated_at AS "updatedAt",
      ${tenantSettings.inventoryDeltaSlaMinutes} AS "inventoryDeltaSlaMinutes"
    FROM ${pharmacies}
    JOIN ${pharmacyChains} ON ${pharmacyChains.id} = ${pharmacies.chainId} AND ${pharmacyChains.status} IN ('approved', 'active')
    JOIN ${tenants} ON ${tenants.id} = ${query.tenantId.value}
    JOIN ${tenantSettings} ON ${tenantSettings.tenantId} = ${tenants.id}
    ${offerLateralFragment(medicineId)}
    WHERE ${visibilityAndTenantScopeFragment()}
      AND ${bboxFilterFragment(query)}
    LIMIT ${PIN_LIMIT}
  `
}

// ─── Маппинг строки результата → PharmacyMapPin ───────────────────────────────────────

function mapRowToPin(row: PinRow, now: Date): PharmacyMapPin {
  return {
    pharmacyId: row.pharmacyId,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    isOpenNow: computeIsOpenNow({
      now,
      is24x7: row.is24x7,
      openingTime: row.openingTime,
      closingTime: row.closingTime,
    }),
    is24x7: row.is24x7,
    offer: mapOffer(row, now),
  }
}

function mapOffer(row: PinRow, now: Date): PharmacyMapPin['offer'] {
  // `== null` (не `===`) НАМЕРЕННО: строка без medicineId вообще не несёт offer-полей
  // (JS `undefined`, не SQL `NULL`), а LATERAL без совпадения отдаёт SQL `NULL`
  // (JS `null`) — оба случая означают «нет предложения» (`eqeqeq: null: ignore`).
  if (
    row.priceDiram == null ||
    row.stockQuantity == null ||
    row.updatedAt == null ||
    row.inventoryDeltaSlaMinutes == null
  ) {
    return null
  }
  const updatedAt = new Date(row.updatedAt)
  return {
    priceDiram: row.priceDiram,
    stockQuantity: row.stockQuantity,
    lastSyncedAt: updatedAt.toISOString(),
    isStale: computeIsStale({ now, updatedAt, slaMinutes: row.inventoryDeltaSlaMinutes }),
  }
}

// ─── "Открыто сейчас" — ВРЕМЕННОЕ дублирование SRS-CAT-046, см. JSDoc файла п.2 ──────

/** Текущее время в Asia/Dushanbe как `HH:MM:00` (совпадает по формату с Postgres `time`). */
function toDushanbeTimeOfDay(utcNow: Date): string {
  const dushanbe = new Date(utcNow.getTime() + DUSHANBE_UTC_OFFSET_HOURS * MS_PER_HOUR)
  const hours = String(dushanbe.getUTCHours()).padStart(2, '0')
  const minutes = String(dushanbe.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}:00`
}

/** Дословно алгоритм SRS-CAT-046 (DTJ-184): `is24x7` — короткое замыкание, иначе интервал с учётом перехода через полночь. */
function computeIsOpenNow(params: {
  readonly now: Date
  readonly is24x7: boolean
  readonly openingTime: string | null
  readonly closingTime: string | null
}): boolean {
  if (params.is24x7) {
    return true
  }
  if (params.openingTime === null || params.closingTime === null) {
    return false
  }
  const current = toDushanbeTimeOfDay(params.now)
  if (params.closingTime >= params.openingTime) {
    return current >= params.openingTime && current <= params.closingTime
  }
  return current >= params.openingTime || current <= params.closingTime
}

function computeIsStale(params: { readonly now: Date; readonly updatedAt: Date; readonly slaMinutes: number }): boolean {
  const elapsedMs = params.now.getTime() - params.updatedAt.getTime()
  const thresholdMs = params.slaMinutes * STALE_THRESHOLD_MULTIPLIER * MS_PER_MINUTE
  return elapsedMs > thresholdMs
}

// ─── Нормализация результата `db.execute` (совпадает с analog-candidates.adapter.ts) ──

function extractRows(result: unknown): readonly PinRow[] {
  if (Array.isArray(result)) {
    return result as PinRow[]
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows as PinRow[]
    }
  }
  return []
}
