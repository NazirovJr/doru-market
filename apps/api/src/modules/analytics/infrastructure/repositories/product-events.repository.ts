import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { productEvents, type ProductEventInsert } from '@/db/schema/product-events.js'
import type { ProductEvent } from '@/modules/analytics/domain/product-event.entity.js'
import {
  PRODUCT_EVENTS_REPOSITORY,
  type ProductEventsRepositoryPort,
} from '@/modules/analytics/application/ports/product-events-repository.port.js'

const SAVINGS_SOURCE_EVENT_TYPES = ['analog_shown', 'added_to_cart'] as const

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

  public async findMatchingSavingsEvents(
    tenantId: string,
    sessionId: string,
    medicineIds: readonly string[],
  ): Promise<ReadonlyMap<string, bigint>> {
    if (medicineIds.length === 0) {
      return new Map()
    }
    const rows = await this.db
      .select({ medicineId: productEvents.medicineId, savingsDiram: productEvents.savingsDiram })
      .from(productEvents)
      .where(
        and(
          eq(productEvents.tenantId, tenantId),
          eq(productEvents.sessionId, sessionId),
          inArray(productEvents.medicineId, [...medicineIds]),
          inArray(productEvents.eventType, [...SAVINGS_SOURCE_EVENT_TYPES]),
          isNotNull(productEvents.savingsDiram),
        ),
      )
      .orderBy(desc(productEvents.occurredAt))
    const out = new Map<string, bigint>()
    for (const row of rows) {
      // Отсортировано по убыванию occurredAt — первое совпадение medicineId уже самое свежее.
      if (row.medicineId !== null && row.savingsDiram !== null && !out.has(row.medicineId)) {
        out.set(row.medicineId, row.savingsDiram)
      }
    }
    return out
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
