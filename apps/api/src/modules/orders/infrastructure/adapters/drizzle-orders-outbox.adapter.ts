/**
 * `DrizzleOrdersOutboxAdapter` (EP-09, DTJ-227) — реализация `OrdersOutboxPort` поверх
 * ОБЩЕЙ таблицы `outbox` (EP-01, DTJ-016). `appendAll` выполняется на переданном `tx` (СВОЯ
 * транзакция группы checkout) — см. JSDoc порта про отличие от fire-and-forget
 * `DrizzleInventoryOutboxAdapter`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import { ORDERS_OUTBOX, type OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import type { OrderDomainEvent } from '@/modules/orders/domain/order-domain-event.js'
import type { OrderUnitOfWorkTx } from '@/modules/orders/application/ports/order-repository.port.js'
import { resolveDrizzleClient } from '@/modules/orders/infrastructure/repositories/drizzle-tx.util.js'

const AGGREGATE_TYPE_ORDER = 'order'

@Injectable()
export class DrizzleOrdersOutboxAdapter implements OrdersOutboxPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async appendAll(tenantId: string, events: readonly OrderDomainEvent[], tx: OrderUnitOfWorkTx): Promise<void> {
    if (events.length === 0) return
    const client = resolveDrizzleClient(this.db, tx)
    await client.insert(outbox).values(
      events.map((event) => ({
        eventType: event.type,
        aggregateType: AGGREGATE_TYPE_ORDER,
        aggregateId: event.orderId,
        payload: event,
        tenantId,
      })),
    )
  }
}

export const ORDERS_OUTBOX_DRIZZLE_PROVIDER = {
  provide: ORDERS_OUTBOX,
  useClass: DrizzleOrdersOutboxAdapter,
} as const
