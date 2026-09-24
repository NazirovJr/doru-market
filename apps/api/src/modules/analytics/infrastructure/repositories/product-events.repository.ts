import { Inject, Injectable } from '@nestjs/common'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { productEvents, type ProductEventInsert } from '@/db/schema/product-events.js'
import type { ProductEvent } from '@/modules/analytics/domain/product-event.entity.js'
import {
  PRODUCT_EVENTS_REPOSITORY,
  type ProductEventsRepositoryPort,
} from '@/modules/analytics/application/ports/product-events-repository.port.js'

@Injectable()
export class ProductEventsRepository implements ProductEventsRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async insert(event: ProductEvent): Promise<void> {
    await this.db.insert(productEvents).values(toRow(event))
  }

  public async insertBatch(events: readonly ProductEvent[]): Promise<void> {
    if (events.length === 0) {
      return
    }
    await this.db.insert(productEvents).values(events.map(toRow))
  }
}

function toRow(event: ProductEvent): ProductEventInsert {
  const snapshot = event.toSnapshot()
  return {
    tenantId: snapshot.tenantId,
    userId: snapshot.userId,
    sessionId: snapshot.sessionId,
    eventType: snapshot.eventType,
    medicineId: snapshot.medicineId,
    pharmacyId: snapshot.pharmacyId,
    orderId: snapshot.orderId,
    savingsDiram: snapshot.savingsDiram,
    metadata: snapshot.metadata,
    occurredAt: snapshot.occurredAt,
  }
}

export const PRODUCT_EVENTS_REPOSITORY_PROVIDER = {
  provide: PRODUCT_EVENTS_REPOSITORY,
  useClass: ProductEventsRepository,
} as const
