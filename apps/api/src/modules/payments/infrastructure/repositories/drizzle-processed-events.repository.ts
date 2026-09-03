/**
 * `DrizzleProcessedEventsRepository` (EP-10, DTJ-244) — реализация `ProcessedEventsPort` поверх
 * ОБЩЕЙ `processed_events` (EP-01, `db/schema/processed-events.schema.ts`) — таблица уже
 * существует, этот файл лишь первый потребитель СО СТОРОНЫ `payments`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { processedEvents } from '@/db/schema/processed-events.schema.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import {
  PROCESSED_EVENTS_PORT,
  type PaymentsUnitOfWorkTxOpaque,
  type ProcessedEventsPort,
} from '@/modules/payments/application/ports/processed-events.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

@Injectable()
export class DrizzleProcessedEventsRepository implements ProcessedEventsPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async markProcessed(consumerName: string, eventId: string, tx?: PaymentsUnitOfWorkTxOpaque): Promise<boolean> {
    const client = resolveDrizzleClient(this.db, tx)
    const inserted = await client
      .insert(processedEvents)
      .values({ consumerName, eventId })
      .onConflictDoNothing()
      .returning({ eventId: processedEvents.eventId })
    return inserted.length > 0
  }
}

export const PROCESSED_EVENTS_PORT_PROVIDER = {
  provide: PROCESSED_EVENTS_PORT,
  useClass: DrizzleProcessedEventsRepository,
} as const
