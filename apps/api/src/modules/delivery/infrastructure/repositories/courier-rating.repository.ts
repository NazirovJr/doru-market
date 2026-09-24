/**
 * `DrizzleCourierRatingRepository` (EP-13, DTJ-321) — реализация `CourierRatingRepositoryPort`
 * поverh `courier_ratings` (`db/schema/courier-ratings.ts`, DTJ-313). 1:1 паттерн
 * `DrizzleCourierShiftRepository` (`resolveDrizzleClient` для tx-прозрачности, DTJ-320) —
 * append-only (`CourierRating` не несёт методов-намерения после создания, только фабрика/save).
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { courierRatings } from '@/db/schema/courier-ratings.js'
import { CourierRating } from '@/modules/delivery/domain/courier-rating.entity.js'
import {
  COURIER_RATING_REPOSITORY,
  type CourierRatingRepositoryPort,
} from '@/modules/delivery/application/ports/courier-rating.repository.port.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

@Injectable()
export class DrizzleCourierRatingRepository implements CourierRatingRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async existsByOrderId(orderId: string, tx?: DeliveryUnitOfWorkTx): Promise<boolean> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client
      .select({ id: courierRatings.id })
      .from(courierRatings)
      .where(eq(courierRatings.orderId, orderId))
      .limit(1)
    return row !== undefined
  }

  public async save(rating: CourierRating, tx?: DeliveryUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const snapshot = rating.toSnapshot()
    await client.insert(courierRatings).values({
      id: snapshot.id,
      orderId: snapshot.orderId,
      courierId: snapshot.courierId,
      customerId: snapshot.customerId,
      rating: snapshot.rating,
      comment: snapshot.comment,
      createdAt: snapshot.createdAt,
    })
  }
}

export const COURIER_RATING_REPOSITORY_PROVIDER = {
  provide: COURIER_RATING_REPOSITORY,
  useClass: DrizzleCourierRatingRepository,
} as const
