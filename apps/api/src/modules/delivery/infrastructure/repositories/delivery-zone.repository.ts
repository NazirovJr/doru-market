import { Inject, Injectable } from '@nestjs/common'
import { and, eq, or, isNull } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { deliveryZones, type DeliveryZoneRow } from '@/db/schema/delivery-zones.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { DeliveryZone, type DeliveryZoneProps } from '@/modules/delivery/domain/delivery-zone.entity.js'
import {
  DELIVERY_ZONE_REPOSITORY,
  type DeliveryZoneRepositoryPort,
} from '@/modules/delivery/application/ports/delivery-zone.repository.port.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

@Injectable()
export class DrizzleDeliveryZoneRepository implements DeliveryZoneRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryZone | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client.select().from(deliveryZones).where(eq(deliveryZones.id, id)).limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async findActiveCoverageCandidates(tenantId: string, tx?: DeliveryUnitOfWorkTx): Promise<readonly DeliveryZone[]> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select()
      .from(deliveryZones)
      .where(
        and(
          eq(deliveryZones.isActive, true),
          or(eq(deliveryZones.tenantId, tenantId), isNull(deliveryZones.tenantId)),
        ),
      )
    return rows.map(toDomain)
  }

  public async findAllByTenant(tenantId: string, tx?: DeliveryUnitOfWorkTx): Promise<readonly DeliveryZone[]> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client.select().from(deliveryZones).where(eq(deliveryZones.tenantId, tenantId))
    return rows.map(toDomain)
  }

  public async save(zone: DeliveryZone, tx?: DeliveryUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const row = toRow(zone)
    await client.insert(deliveryZones).values(row).onConflictDoUpdate({ target: deliveryZones.id, set: row })
  }
}

function toDomain(row: DeliveryZoneRow): DeliveryZone {
  const geo = GeoPoint.create(Number(row.centerLatitude), Number(row.centerLongitude))
  if (!geo.ok) {
    throw new Error(`Corrupt delivery zone center in DB for zone ${row.id}: ${geo.error.message}`)
  }
  const props: DeliveryZoneProps = {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    center: geo.value,
    radiusKm: Number(row.radiusKm),
    priority: row.priority,
    isActive: row.isActive,
  }
  return DeliveryZone.restore(props)
}

function toRow(zone: DeliveryZone): typeof deliveryZones.$inferInsert {
  return {
    id: zone.id,
    tenantId: zone.tenantId,
    name: zone.props.name,
    centerLatitude: zone.props.center.latitude.toString(),
    centerLongitude: zone.props.center.longitude.toString(),
    radiusKm: zone.radiusKm.toString(),
    priority: zone.priority,
    isActive: zone.isActive,
  }
}

export const DELIVERY_ZONE_REPOSITORY_PROVIDER = {
  provide: DELIVERY_ZONE_REPOSITORY,
  useClass: DrizzleDeliveryZoneRepository,
} as const
