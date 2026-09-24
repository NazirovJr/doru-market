import { Inject, Injectable } from '@nestjs/common'
import { processedEvents } from '@/db/schema/processed-events.schema.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { PROCESSED_EVENTS_PORT, type ProcessedEventsPort } from './processed-events.port.js'

// Единственная реализация — раньше было три копии (payments/returns/notifications), консолидировано.
@Injectable()
export class DrizzleProcessedEventsRepository implements ProcessedEventsPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async markProcessed(consumerName: string, eventId: string, tx?: unknown): Promise<boolean> {
    const client = (tx ?? this.db) as DrizzleDb
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
