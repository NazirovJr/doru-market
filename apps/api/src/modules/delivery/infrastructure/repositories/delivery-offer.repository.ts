import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { deliveryOffers, type DeliveryOfferRow } from '@/db/schema/delivery-offers.js'
import { DeliveryOffer } from '@/modules/delivery/domain/delivery-offer.entity.js'
import type { DeliveryOfferSnapshot } from '@/modules/delivery/domain/delivery-offer.entity.js'
import {
  DELIVERY_OFFER_REPOSITORY,
  type DeliveryOfferRepositoryPort,
} from '@/modules/delivery/application/ports/delivery-offer.repository.port.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

const SCORE_DECIMALS = 4

@Injectable()
export class DrizzleDeliveryOfferRepository implements DeliveryOfferRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryOffer | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client.select().from(deliveryOffers).where(eq(deliveryOffers.id, id)).limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async findByIdForUpdate(id: string, tx: DeliveryUnitOfWorkTx): Promise<DeliveryOffer | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client.select().from(deliveryOffers).where(eq(deliveryOffers.id, id)).limit(1).for('update')
    return row === undefined ? null : toDomain(row)
  }

  public async findPendingByCourierId(courierId: string, tx?: DeliveryUnitOfWorkTx): Promise<readonly DeliveryOffer[]> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select()
      .from(deliveryOffers)
      .where(and(eq(deliveryOffers.courierId, courierId), eq(deliveryOffers.status, 'pending')))
    return rows.map(toDomain)
  }

  public async findByAssignmentId(assignmentId: string, tx?: DeliveryUnitOfWorkTx): Promise<readonly DeliveryOffer[]> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client.select().from(deliveryOffers).where(eq(deliveryOffers.deliveryAssignmentId, assignmentId))
    return rows.map(toDomain)
  }

  public async save(offer: DeliveryOffer, tx?: DeliveryUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const row = toRow(offer.toSnapshot())
    await client.insert(deliveryOffers).values(row).onConflictDoUpdate({ target: deliveryOffers.id, set: row })
  }
}

function toDomain(row: DeliveryOfferRow): DeliveryOffer {
  const snapshot: DeliveryOfferSnapshot = {
    id: row.id,
    deliveryAssignmentId: row.deliveryAssignmentId,
    courierId: row.courierId,
    sequenceNo: row.sequenceNo,
    status: row.status,
    distanceMeters: row.distanceMeters,
    score: Number(row.score),
    offeredAt: row.offeredAt,
    expiresAt: row.expiresAt,
    respondedAt: row.respondedAt,
    declineReason: row.declineReason,
  }
  return DeliveryOffer.restore(snapshot)
}

function toRow(s: DeliveryOfferSnapshot): typeof deliveryOffers.$inferInsert {
  return {
    id: s.id,
    deliveryAssignmentId: s.deliveryAssignmentId,
    courierId: s.courierId,
    sequenceNo: s.sequenceNo,
    status: s.status,
    distanceMeters: s.distanceMeters,
    score: s.score.toFixed(SCORE_DECIMALS),
    offeredAt: s.offeredAt,
    expiresAt: s.expiresAt,
    respondedAt: s.respondedAt,
    declineReason: s.declineReason,
  }
}

export const DELIVERY_OFFER_REPOSITORY_PROVIDER = {
  provide: DELIVERY_OFFER_REPOSITORY,
  useClass: DrizzleDeliveryOfferRepository,
} as const
