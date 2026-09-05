/**
 * Drizzle-схема `delivery_zones` (EP-13, DTJ-313) — `25-module-courier-delivery.md` §D.6.
 *
 * **ОТКЛОНЕНИЕ от канонического DDL**: `center_geo_point GEOGRAPHY(POINT,4326)` + `ix_delivery_zones_geo`
 * (GiST) заменены на `center_latitude`/`center_longitude` (`NUMERIC`) + обычный составной btree
 * `ix_delivery_zones_lat_lon`. Причина — та же, что `delivery-assignments.ts`: `postgis` НЕ ставится
 * в образ `postgres:16` этого окружения (`pg_available_extensions` — 0 строк, независимо
 * подтверждено; уже задокументировано `apps/api/src/db/schema/pharmacies.ts`/DTJ-195 постмортем и
 * `migrations/0022_pharmacies_lat_lon_index.sql` — тот же вывод по тому же образу, другой тикет).
 * Резолюция зоны (`ST_DWithin` → bbox-предфильтр по этому индексу + точный гаверсинус
 * `GeoPoint.distanceTo` в application-слое) — тот же приём, что `postgres-search.sql.ts` (DTJ-185)
 * и `postgres-pharmacy-map.adapter.ts` (DTJ-195), реализуется `DeliveryFacade.calculateDeliveryFee`
 * (DTJ-314+, вне периметра этого тикета).
 *
 * Зона — окружность (`center`+`radius_km`), не полигон (D-05, простейшая модель для MVP-масштаба
 * города). `tenant_id IS NULL` = глобальный дефолт (neutral).
 */
import { sql } from 'drizzle-orm'
import { boolean, check, index, numeric, pgTable, smallint, uuid, varchar } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const DELIVERY_ZONES_TABLE = 'delivery_zones'

export const deliveryZones = pgTable(
  DELIVERY_ZONES_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    centerLatitude: numeric('center_latitude', { precision: 10, scale: 8 }).notNull(),
    centerLongitude: numeric('center_longitude', { precision: 11, scale: 8 }).notNull(),
    radiusKm: numeric('radius_km', { precision: 6, scale: 2 }).notNull(),
    /** Меньше = выше приоритет при перекрытии зон. */
    priority: smallint('priority').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [
    check('chk_delivery_zones_radius_positive', sql`${table.radiusKm} > 0`),
    index('ix_delivery_zones_lat_lon').on(table.centerLatitude, table.centerLongitude),
  ],
)
