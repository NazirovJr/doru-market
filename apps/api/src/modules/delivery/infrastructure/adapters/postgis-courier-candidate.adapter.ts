/**
 * `PostgisCourierCandidateAdapter` (EP-13, DTJ-314, SRS-DELIV-038) — реализация
 * `CourierCandidatePort`. Имя файла — из `files_owned` тикета; PostGIS фактически НЕ
 * используется — `pg_available_extensions` даёт 0 строк для `postgis%` в образе `postgres:16`
 * этого окружения (тот же вывод, что DTJ-185/195/313, см. JSDoc порта и
 * `apps/api/src/modules/catalog/infrastructure/adapters/postgres-search.sql.ts` п.1). Гаверсинус
 * на `couriers.last_known_latitude/longitude` — `EARTH_RADIUS_METERS` совпадает с
 * `GeoPoint.distanceTo()` (`shared-kernel`) и с `postgres-search.sql.ts`.
 *
 * 4 из 7 условий фильтра приемлемости SRS-DELIV-038 п.1 — SQL-native, реализованы здесь:
 * `status='active'`, `shift_status='on_shift'`, дистанция `<= radiusKm`, `last_location_at` не
 * старше `locationStaleMinutes` (курьер без локации — `last_known_latitude/longitude IS NULL` —
 * структурно не проходит, дистанцию посчитать не от чего). Остальные 3 (chain-guard,
 * cold-chain, потолок нагрузки) — `SuggestNearestCourierUseCase` (см. его JSDoc) — адаптер
 * лишь ВОЗВРАЩАЕТ данные для них (`courierChainId`/`coldChainCertified`/
 * `activeAssignmentsCount`), не фильтрует по ним.
 *
 * `activeAssignmentsCount` — `COUNT(*)` через `LEFT JOIN LATERAL` на `delivery_assignments`
 * (нетерминальные, тот же критерий, что `ux_delivery_assignment_one_active`). Postgres возвращает
 * `COUNT(*)` как `bigint` (строка через `pg`-драйвер) — явный `::int` в SQL, число мало
 * (потолок конкурентных назначений), переполнение `int` не грозит.
 */
import { Inject, Injectable } from '@nestjs/common'
import { sql, type SQL } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { couriers } from '@/db/schema/couriers.js'
import {
  COURIER_CANDIDATE_PORT,
  type CourierCandidate,
  type CourierCandidatePort,
  type CourierCandidateQuery,
} from '@/modules/delivery/application/ports/courier-candidate.port.js'

/** Совпадает с `GeoPoint.distanceTo()` (`shared-kernel`) и `postgres-search.sql.ts` (см. JSDoc файла). */
const EARTH_RADIUS_METERS = 6_371_000
const METERS_PER_KM = 1000

interface CandidateRow {
  readonly courierId: string
  readonly courierChainId: string | null
  readonly coldChainCertified: boolean
  readonly ratingAvg: number
  readonly activeAssignmentsCount: number
  readonly distanceMeters: number
}

@Injectable()
export class PostgisCourierCandidateAdapter implements CourierCandidatePort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findEligibleCandidates(query: CourierCandidateQuery): Promise<readonly CourierCandidate[]> {
    const rows = extractRows(await this.db.execute(buildCandidatesQuery(query)))
    return rows.map(toCandidate)
  }
}

function distanceExprFragment(query: CourierCandidateQuery): SQL {
  const lat = query.pharmacyGeoPoint.latitude
  const lon = query.pharmacyGeoPoint.longitude
  return sql`(
    ${2 * EARTH_RADIUS_METERS} * asin(sqrt(
      power(sin(radians((${lat}::double precision - ${couriers.lastKnownLatitude}::double precision)) / 2), 2) +
      cos(radians(${couriers.lastKnownLatitude}::double precision)) * cos(radians(${lat}::double precision)) *
      power(sin(radians((${lon}::double precision - ${couriers.lastKnownLongitude}::double precision)) / 2), 2)
    ))
  )`
}

function buildCandidatesQuery(query: CourierCandidateQuery): SQL {
  const radiusMeters = query.radiusKm * METERS_PER_KM
  const distanceExpr = distanceExprFragment(query)
  return sql`
    SELECT
      ${couriers.id} AS "courierId",
      ${couriers.chainId} AS "courierChainId",
      ${couriers.coldChainCertified} AS "coldChainCertified",
      ${couriers.ratingAvg}::double precision AS "ratingAvg",
      COALESCE(active.cnt, 0)::int AS "activeAssignmentsCount",
      ${distanceExpr}::double precision AS "distanceMeters"
    FROM ${couriers}
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt
      FROM delivery_assignments da
      WHERE da.courier_id = ${couriers.id}
        AND da.status NOT IN ('delivered', 'delivery_failed')
    ) active ON true
    WHERE ${couriers.status} = 'active'
      AND ${couriers.shiftStatus} = 'on_shift'
      AND ${couriers.lastKnownLatitude} IS NOT NULL
      AND ${couriers.lastKnownLongitude} IS NOT NULL
      AND ${couriers.lastLocationAt} >= NOW() - (${query.locationStaleMinutes} || ' minutes')::interval
      AND ${distanceExpr} <= ${radiusMeters}
  `
}

function toCandidate(row: CandidateRow): CourierCandidate {
  return {
    courierId: row.courierId,
    courierChainId: row.courierChainId,
    coldChainCertified: row.coldChainCertified,
    ratingAvg: row.ratingAvg,
    activeAssignmentsCount: row.activeAssignmentsCount,
    distanceMeters: row.distanceMeters,
  }
}

/** 1:1 `postgres-pharmacy-map.adapter.ts` (DTJ-195) — нормализация формы `db.execute()`. */
function extractRows(result: unknown): readonly CandidateRow[] {
  if (Array.isArray(result)) {
    return result as CandidateRow[]
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows as CandidateRow[]
    }
  }
  return []
}

export const COURIER_CANDIDATE_PORT_PROVIDER = {
  provide: COURIER_CANDIDATE_PORT,
  useClass: PostgisCourierCandidateAdapter,
} as const
