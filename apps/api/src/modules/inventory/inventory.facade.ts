// Порог устаревания — дефолт tenant_settings.inventory_delta_sla_minutes: per-tenant override
// требует tenantId аптеки из чужого модуля; тот же fallback, что в postgres-search.adapter.ts.
import { Inject, Injectable } from '@nestjs/common'
import { inArray, sql } from 'drizzle-orm'
import type { PharmacyOfferPublic } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { pharmacyChains } from '@/db/schema/pharmacy-chains.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
} from './application/ports/inventory-sync-batch.repository.port.js'
import {
  PHARMACY_INVENTORY_REPOSITORY,
  type PharmacyInventoryRepository,
} from './application/ports/pharmacy-inventory.repository.port.js'
import { CreatePharmacyApiKeyUseCase } from './application/use-cases/create-pharmacy-api-key.use-case.js'
import { ListPharmacyApiKeysUseCase } from './application/use-cases/list-pharmacy-api-keys.use-case.js'
import { RevokePharmacyApiKeyUseCase } from './application/use-cases/revoke-pharmacy-api-key.use-case.js'
import { RotatePharmacyApiKeyUseCase } from './application/use-cases/rotate-pharmacy-api-key.use-case.js'
import { SetPharmacyApiKeyMtlsUseCase } from './application/use-cases/set-pharmacy-api-key-mtls.use-case.js'
import { RevokeExpiredRotatedKeyUseCase } from './application/use-cases/revoke-expired-rotated-key.use-case.js'
import type { CreatedPharmacyApiKey, PharmacyApiKeySummary, RotatePharmacyApiKeyParams } from './application/ports/pharmacy-api-keys.repository.port.js'

const ASSUMED_INVENTORY_DELTA_SLA_MINUTES = 5
const MS_PER_MINUTE = 60_000
const PERCENT_MULTIPLIER = 100
// DTJ-439: тот же множитель "стал" ли оффер, что postgres-search.adapter.ts (SEARCH_DRIVER='postgres'
// не экспортирует его — дублируется, см. отчёт сдачи).
const STALE_THRESHOLD_MULTIPLIER = 3

export interface InventorySummary {
  readonly skuCount: number
  readonly staleDataSharePercent: number
}

/** DTJ-439: вход `getOffersForMedicines` — 1:1 с `AnalogOfferLookupInput` (catalog, порт вне files_owned). */
export interface AnalogOfferBatchInput {
  readonly medicineIds: readonly string[]
  readonly geo?: { readonly lat: number; readonly lon: number }
  readonly radiusMeters: number
}

interface AnalogOfferRow {
  readonly medicine_id: string
  readonly pharmacy_id: string
  readonly price: number
  readonly updated_at: string | Date
  readonly latitude: number
  readonly longitude: number
}

@Injectable()
export class InventoryFacade {
  // eslint-disable-next-line max-params -- NestJS DI: 6 конструктор-инъекций, та же практика, что telegram-auth.use-case.ts
  constructor(
    @Inject(PHARMACY_INVENTORY_REPOSITORY) private readonly repository: PharmacyInventoryRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY) private readonly syncBatchRepository: InventorySyncBatchRepository,
    @Inject(CreatePharmacyApiKeyUseCase) private readonly createPharmacyApiKeyUseCase: CreatePharmacyApiKeyUseCase,
    @Inject(ListPharmacyApiKeysUseCase) private readonly listPharmacyApiKeysUseCase: ListPharmacyApiKeysUseCase,
    @Inject(RevokePharmacyApiKeyUseCase) private readonly revokePharmacyApiKeyUseCase: RevokePharmacyApiKeyUseCase,
    @Inject(RotatePharmacyApiKeyUseCase) private readonly rotatePharmacyApiKeyUseCase: RotatePharmacyApiKeyUseCase,
    @Inject(SetPharmacyApiKeyMtlsUseCase) private readonly setPharmacyApiKeyMtlsUseCase: SetPharmacyApiKeyMtlsUseCase,
    @Inject(RevokeExpiredRotatedKeyUseCase) private readonly revokeExpiredRotatedKeyUseCase: RevokeExpiredRotatedKeyUseCase,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
  ) {}

  async getInventorySummary(pharmacyId: string): Promise<InventorySummary> {
    const staleBefore = new Date(this.clock.now().getTime() - ASSUMED_INVENTORY_DELTA_SLA_MINUTES * MS_PER_MINUTE)
    const { skuCount, totalRowCount, staleRowCount } = await this.repository.getSummary({ pharmacyId, staleBefore })
    const staleDataSharePercent = totalRowCount === 0 ? 0 : Math.round((staleRowCount / totalRowCount) * PERCENT_MULTIPLIER)
    return { skuCount, staleDataSharePercent }
  }

  async findPharmacyIdsWithRecentSyncActivity(
    pharmacyIds: readonly string[],
    sinceDate: Date,
  ): Promise<ReadonlySet<string>> {
    const ids = await this.syncBatchRepository.findPharmacyIdsWithActivitySince(pharmacyIds, sinceDate)
    return new Set(ids)
  }

  async createPharmacyApiKey(pharmacyId: string, createdByAdminId: string): Promise<CreatedPharmacyApiKey> {
    return this.createPharmacyApiKeyUseCase.execute(pharmacyId, createdByAdminId)
  }

  async listPharmacyApiKeys(pharmacyId: string): Promise<readonly PharmacyApiKeySummary[]> {
    return this.listPharmacyApiKeysUseCase.execute(pharmacyId)
  }

  async revokePharmacyApiKey(pharmacyId: string, keyId: string, reason: string): Promise<boolean> {
    return this.revokePharmacyApiKeyUseCase.execute(pharmacyId, keyId, reason)
  }

  async rotatePharmacyApiKey(params: RotatePharmacyApiKeyParams): Promise<CreatedPharmacyApiKey | null> {
    return this.rotatePharmacyApiKeyUseCase.execute(params)
  }

  async setPharmacyApiKeyMtls(pharmacyId: string, keyId: string, requireMtls: boolean): Promise<PharmacyApiKeySummary | null> {
    return this.setPharmacyApiKeyMtlsUseCase.execute(pharmacyId, keyId, requireMtls)
  }

  async revokeExpiredRotatedKey(keyId: string): Promise<boolean> {
    return this.revokeExpiredRotatedKeyUseCase.execute(keyId)
  }

  /**
   * DTJ-439: офферы аптек для батча medicineId (аналоги) — активная аптека/сеть,
   * quantity>0, тот же фильтр видимости, что postgres-search.sql.ts (DTJ-185).
   * Радиус/дистанция — в памяти через GeoPoint (переиспользует VO вместо второй
   * копии гаверсинуса на SQL).
   */
  async getOffersForMedicines(input: AnalogOfferBatchInput): Promise<ReadonlyMap<string, readonly PharmacyOfferPublic[]>> {
    if (input.medicineIds.length === 0) return new Map()
    const rows = await this.queryOfferRows(input.medicineIds)
    return this.toOfferMap(rows, input.geo, input.radiusMeters)
  }

  private async queryOfferRows(medicineIds: readonly string[]): Promise<readonly AnalogOfferRow[]> {
    const query = sql`
      SELECT DISTINCT ON (${pharmacyInventory.medicineId}, ${pharmacyInventory.pharmacyId})
        ${pharmacyInventory.medicineId} AS medicine_id,
        ${pharmacyInventory.pharmacyId} AS pharmacy_id,
        ${pharmacyInventory.price} AS price,
        ${pharmacyInventory.updatedAt} AS updated_at,
        ${pharmacies.latitude}::double precision AS latitude,
        ${pharmacies.longitude}::double precision AS longitude
      FROM ${pharmacyInventory}
      JOIN ${pharmacies} ON ${pharmacies.id} = ${pharmacyInventory.pharmacyId} AND ${pharmacies.status} = 'active'
      JOIN ${pharmacyChains} ON ${pharmacyChains.id} = ${pharmacies.chainId} AND ${pharmacyChains.status} IN ('approved', 'active')
      WHERE ${inArray(pharmacyInventory.medicineId, medicineIds as string[])} AND ${pharmacyInventory.quantity} > 0
      ORDER BY ${pharmacyInventory.medicineId}, ${pharmacyInventory.pharmacyId}, ${pharmacyInventory.price} ASC, ${pharmacyInventory.updatedAt} DESC
    `
    const result = await this.db.execute<AnalogOfferRow & Record<string, unknown>>(query)
    return extractOfferRows(result)
  }

  // Дешёвых офферов на медикамент мало (candidates ≤ 51) — сортировка/фильтр радиуса в памяти дешевле,
  // чем повторять гаверсинус-SQL postgres-search.sql.ts (тот файл вне files_owned, не экспортирует фрагмент).
  private toOfferMap(
    rows: readonly AnalogOfferRow[],
    geo: { readonly lat: number; readonly lon: number } | undefined,
    radiusMeters: number,
  ): ReadonlyMap<string, readonly PharmacyOfferPublic[]> {
    const userPoint = toGeoPointOrNull(geo)
    const now = this.clock.now()
    const byMedicine = new Map<string, PharmacyOfferPublic[]>()
    for (const row of rows) {
      const distanceMeters = distanceOrNull(userPoint, row.latitude, row.longitude)
      if (userPoint !== null && (distanceMeters === null || distanceMeters > radiusMeters)) continue
      const list = byMedicine.get(row.medicine_id) ?? []
      list.push({
        pharmacyId: row.pharmacy_id,
        priceDiram: row.price,
        distanceMeters,
        isStale: isOfferStale(row.updated_at, now),
        lastSyncedAt: new Date(row.updated_at).toISOString(),
      })
      byMedicine.set(row.medicine_id, list)
    }
    for (const list of byMedicine.values()) list.sort((a, b) => a.priceDiram - b.priceDiram)
    return byMedicine
  }
}

function extractOfferRows(result: unknown): readonly AnalogOfferRow[] {
  if (Array.isArray(result)) return result as readonly AnalogOfferRow[]
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) return rows as readonly AnalogOfferRow[]
  }
  return []
}

function toGeoPointOrNull(geo: { readonly lat: number; readonly lon: number } | undefined): GeoPoint | null {
  if (geo === undefined) return null
  const created = GeoPoint.create(geo.lat, geo.lon)
  return created.ok ? created.value : null
}

function distanceOrNull(userPoint: GeoPoint | null, latitude: number, longitude: number): number | null {
  if (userPoint === null) return null
  const pharmacyPoint = GeoPoint.create(latitude, longitude)
  return pharmacyPoint.ok ? userPoint.distanceTo(pharmacyPoint.value) : null
}

function isOfferStale(updatedAt: string | Date, now: Date): boolean {
  const staleThresholdMs = ASSUMED_INVENTORY_DELTA_SLA_MINUTES * STALE_THRESHOLD_MULTIPLIER * MS_PER_MINUTE
  return now.getTime() - new Date(updatedAt).getTime() > staleThresholdMs
}
