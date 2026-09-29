import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { processedEvents } from '@/db/schema/processed-events.schema.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { PROCESSED_EVENTS_PORT, type ProcessedEventsPort } from './processed-events.port.js'

// Единственная реализация — раньше было три копии (payments/returns/notifications), консолидировано.
@Injectable()
export class DrizzleProcessedEventsRepository implements ProcessedEventsPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async isProcessed(consumerName: string, eventId: string): Promise<boolean> {
    const rows = await this.db
      .select({ eventId: processedEvents.eventId })
      .from(processedEvents)
      .where(and(eq(processedEvents.consumerName, consumerName), eq(processedEvents.eventId, eventId)))
      .limit(1)
    return rows.length > 0
  }

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
