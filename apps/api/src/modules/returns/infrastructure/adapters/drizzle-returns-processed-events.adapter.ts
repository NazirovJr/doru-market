/**
 * `DrizzleReturnsProcessedEventsAdapter` (EP-11, DTJ-274) — реализация `ReturnsProcessedEventsPort`
 * поверх ОБЩЕЙ `processed_events` (EP-01) — 1:1 приём `DrizzleProcessedEventsRepository` модуля
 * `payments` (DTJ-244), `consumer_name` этого модуля — `'returns.on-resolved'`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { processedEvents } from '@/db/schema/processed-events.schema.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import {
  RETURNS_PROCESSED_EVENTS_PORT,
  type ReturnsProcessedEventsPort,
} from '@/modules/returns/application/ports/returns-processed-events.port.js'
import type { ReturnsUnitOfWorkTx } from '@/modules/returns/application/ports/orders-facade.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

@Injectable()
export class DrizzleReturnsProcessedEventsAdapter implements ReturnsProcessedEventsPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async markProcessed(consumerName: string, eventId: string, tx?: ReturnsUnitOfWorkTx): Promise<boolean> {
    const client = resolveDrizzleClient(this.db, tx)
    const inserted = await client
      .insert(processedEvents)
      .values({ consumerName, eventId })
      .onConflictDoNothing()
      .returning({ eventId: processedEvents.eventId })
    return inserted.length > 0
  }
}

export const RETURNS_PROCESSED_EVENTS_DRIZZLE_PROVIDER = {
  provide: RETURNS_PROCESSED_EVENTS_PORT,
  useClass: DrizzleReturnsProcessedEventsAdapter,
} as const
