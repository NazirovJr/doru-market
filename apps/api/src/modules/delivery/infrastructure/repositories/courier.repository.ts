/**
 * `DrizzleCourierRepository` (EP-13, DTJ-314) — реализация `CourierRepositoryPort` поверх
 * `couriers` (`db/schema/couriers.ts`, DTJ-313). 1:1 паттерн `DrizzleSupportTicketsRepository`
 * (upsert по `id`, `resolveDrizzleClient` для tx-прозрачности).
 *
 * **numeric-ловушка** (см. `postgres-pharmacy-map.adapter.ts` DTJ-195): `rating_avg` —
 * `numeric(3,2)`, Drizzle query-builder без `{mode:'number'}` возвращает его СТРОКОЙ — явный
 * `Number(row.ratingAvg)` при чтении, иначе `Courier.ratingAvg` ушёл бы в домен строкой.
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { couriers, type CourierRow } from '@/db/schema/couriers.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { Courier, type CourierProps } from '@/modules/delivery/domain/courier.entity.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '@/modules/delivery/application/ports/courier.repository.port.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

@Injectable()
export class DrizzleCourierRepository implements CourierRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<Courier | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client.select().from(couriers).where(eq(couriers.id, id)).limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async findByUserId(userId: string, tx?: DeliveryUnitOfWorkTx): Promise<Courier | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client.select().from(couriers).where(eq(couriers.userId, userId)).limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async save(courier: Courier, tx?: DeliveryUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const row = toRow(courier)
    await client.insert(couriers).values(row).onConflictDoUpdate({ target: couriers.id, set: row })
  }
}

function toDomain(row: CourierRow): Courier {
  const props: CourierProps = {
    id: row.id,
    userId: row.userId,
    chainId: row.chainId,
    status: row.status,
    taxStatus: row.taxStatus,
    taxStatusDocumentUrl: row.taxStatusDocumentUrl,
    vehicleType: row.vehicleType,
    coldChainCertified: row.coldChainCertified,
    healthCertificateUrl: row.healthCertificateUrl,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt ?? new Date(0),
    lastKnownLocation: toLastKnownLocation(row),
    shiftStatus: row.shiftStatus,
    ratingAvg: Number(row.ratingAvg),
    ratingCount: row.ratingCount,
    currentCashOnHandDiram: Money.fromDiram(row.currentCashOnHandDiram),
  }
  return Courier.restore(props)
}

function toLastKnownLocation(row: CourierRow): CourierProps['lastKnownLocation'] {
  if (row.lastKnownLatitude === null || row.lastKnownLongitude === null || row.lastLocationAt === null) {
    return null
  }
  const geo = GeoPoint.create(Number(row.lastKnownLatitude), Number(row.lastKnownLongitude))
  // Координаты уже прошли валидацию при записи (SRS-DOM-072) — невалидная строка в БД означала бы
  // порчу данных вне контроля этого репозитория; сигнализируем явно, не подставляем `null` молча.
  if (!geo.ok) {
    throw new Error(`Corrupt courier location in DB for last_known_lat/lon: ${geo.error.message}`)
  }
  return { point: geo.value, capturedAt: row.lastLocationAt }
}

function toRow(courier: Courier): typeof couriers.$inferInsert {
  return {
    id: courier.id,
    userId: courier.props.userId,
    chainId: courier.chainId,
    status: courier.status,
    taxStatus: courier.props.taxStatus,
    taxStatusDocumentUrl: courier.props.taxStatusDocumentUrl,
    vehicleType: courier.props.vehicleType,
    coldChainCertified: courier.coldChainCertified,
    healthCertificateUrl: courier.props.healthCertificateUrl,
    verifiedBy: courier.props.verifiedBy,
    verifiedAt: courier.props.verifiedAt,
    createdAt: courier.props.createdAt,
    lastKnownLatitude: courier.lastKnownLocation?.point.latitude.toString() ?? null,
    lastKnownLongitude: courier.lastKnownLocation?.point.longitude.toString() ?? null,
    lastLocationAt: courier.lastKnownLocation?.capturedAt ?? null,
    shiftStatus: courier.shiftStatus,
    ratingAvg: courier.ratingAvg.toFixed(2),
    ratingCount: courier.ratingCount,
    currentCashOnHandDiram: courier.currentCashOnHandDiram.diram,
  }
}

export const COURIER_REPOSITORY_PROVIDER = {
  provide: COURIER_REPOSITORY,
  useClass: DrizzleCourierRepository,
} as const
