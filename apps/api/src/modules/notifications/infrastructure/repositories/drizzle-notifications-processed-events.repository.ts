/** Реализация `NotificationsProcessedEventsPort` поверх общей `processed_events` (как у payments). */
import { Inject, Injectable } from '@nestjs/common'
import { processedEvents } from '@/db/schema/processed-events.schema.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import type { NotificationsProcessedEventsPort } from '@/modules/notifications/application/ports/notifications-processed-events.port.js'

@Injectable()
export class DrizzleNotificationsProcessedEventsRepository implements NotificationsProcessedEventsPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async markProcessed(consumerName: string, eventId: string): Promise<boolean> {
    const inserted = await this.db
      .insert(processedEvents)
      .values({ consumerName, eventId })
      .onConflictDoNothing()
      .returning({ eventId: processedEvents.eventId })
    return inserted.length > 0
  }
}
