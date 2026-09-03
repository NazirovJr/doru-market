/**
 * `DrizzlePaymentsOutboxAdapter` (EP-10, DTJ-242) — реализация `PaymentsOutboxPort` поверх
 * ОБЩЕЙ таблицы `outbox` (EP-01, DTJ-016). `append` выполняется на переданном `tx` (транзакция
 * вебхука) — см. JSDoc порта.
 */
import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import { PAYMENTS_OUTBOX, type PaymentsOutboxPort } from '@/modules/payments/application/ports/payments-outbox.port.js'
import type { PaymentsDomainEvent } from '@/modules/payments/domain/payment-domain-event.js'
import type { PaymentsUnitOfWorkTx } from '@/modules/payments/application/ports/orders-facade.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

const AGGREGATE_TYPE_ORDER = 'order'

@Injectable()
export class DrizzlePaymentsOutboxAdapter implements PaymentsOutboxPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async append(tenantId: string, event: PaymentsDomainEvent, tx: PaymentsUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    await client.insert(outbox).values({
      eventType: event.type,
      aggregateType: AGGREGATE_TYPE_ORDER,
      aggregateId: event.orderId,
      payload: event,
      tenantId,
    })
  }
}

export const PAYMENTS_OUTBOX_DRIZZLE_PROVIDER = {
  provide: PAYMENTS_OUTBOX,
  useClass: DrizzlePaymentsOutboxAdapter,
} as const
