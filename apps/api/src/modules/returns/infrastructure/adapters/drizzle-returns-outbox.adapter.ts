/**
 * `DrizzleReturnsOutboxAdapter` (EP-11, DTJ-273) — реализация `ReturnsOutboxPort` поверх ОБЩЕЙ
 * таблицы `outbox` (EP-01, DTJ-016), 1:1 паттерн `support/infrastructure/adapters/
 * drizzle-support-outbox.adapter.ts` (DTJ-279).
 */
import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import {
  RETURNS_OUTBOX,
  type ReturnsOutboxPort,
  type ReturnsDomainEvent,
} from '@/modules/returns/application/ports/returns-outbox.port.js'
import type { ReturnsUnitOfWorkTx } from '@/modules/returns/application/ports/orders-facade.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

const AGGREGATE_TYPE_ORDER_RETURN = 'order_return'

@Injectable()
export class DrizzleReturnsOutboxAdapter implements ReturnsOutboxPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async append(tenantId: string, event: ReturnsDomainEvent, tx: ReturnsUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    await client.insert(outbox).values({
      eventType: event.type,
      aggregateType: AGGREGATE_TYPE_ORDER_RETURN,
      aggregateId: event.returnId,
      payload: event,
      tenantId,
    })
  }
}

export const RETURNS_OUTBOX_DRIZZLE_PROVIDER = {
  provide: RETURNS_OUTBOX,
  useClass: DrizzleReturnsOutboxAdapter,
} as const
