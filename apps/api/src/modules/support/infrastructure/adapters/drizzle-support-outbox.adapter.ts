/**
 * `DrizzleSupportOutboxAdapter` (EP-14, DTJ-279/280) — реализация `SupportOutboxPort` поверх
 * ОБЩЕЙ таблицы `outbox` (EP-01, DTJ-016). `append` выполняется на переданном `tx` (транзакция
 * вызывающего use case) — см. JSDoc порта.
 */
import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import {
  SUPPORT_OUTBOX,
  type SupportOutboxEvent,
  type SupportOutboxPort,
} from '@/modules/support/application/ports/support-outbox.port.js'
import type { SupportUnitOfWorkTx } from '@/modules/support/application/ports/support-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

const AGGREGATE_TYPE_SUPPORT_TICKET = 'support_ticket'

@Injectable()
export class DrizzleSupportOutboxAdapter implements SupportOutboxPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async append(tenantId: string, event: SupportOutboxEvent, tx: SupportUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    await client.insert(outbox).values({
      eventType: event.type,
      aggregateType: AGGREGATE_TYPE_SUPPORT_TICKET,
      aggregateId: aggregateIdOf(event),
      payload: event,
      tenantId,
    })
  }
}

/** `SupportTicketCreatedEvent.ticketId` vs `SlaBreachedEvent.entityId` — оба идентифицируют одну и ту же строку `support_tickets`. */
function aggregateIdOf(event: SupportOutboxEvent): string {
  return event.type === 'SlaBreachedEvent' ? event.entityId : event.ticketId
}

export const SUPPORT_OUTBOX_DRIZZLE_PROVIDER = {
  provide: SUPPORT_OUTBOX,
  useClass: DrizzleSupportOutboxAdapter,
} as const
