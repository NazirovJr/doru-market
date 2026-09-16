/**
 * `DrizzlePartialFulfillmentRequestRepository` (EP-12, DTJ-304) — реализация
 * `PartialFulfillmentRequestRepositoryPort` поверх `order_partial_fulfillment_requests`
 * (DTJ-300, `db/schema/order-partial-fulfillment-requests.ts`).
 *
 * `tenantId`-скоуп read-методов — `INNER JOIN orders` (таблица не несёт своей колонки
 * `tenant_id`, см. JSDoc порта) — чужой тенант ⇒ `undefined`/`null` (SRS-API-046).
 *
 * `tx` резолвится `resolveDrizzleClient` — тот же общий хелпер, что `DrizzleOrderRepository`
 * (`orders/infrastructure/repositories/drizzle-tx.util.ts`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import {
  orderPartialFulfillmentRequests,
  type OrderPartialFulfillmentRequestRow,
} from '@/db/schema/order-partial-fulfillment-requests.js'
import { orders } from '@/db/schema/orders.js'
import {
  PARTIAL_FULFILLMENT_REQUEST_REPOSITORY,
  type CreatePartialFulfillmentRequestInput,
  type PartialFulfillmentRequestRecord,
  type PartialFulfillmentRequestRepositoryPort,
  type PartialFulfillmentSnapshotItemRecord,
  type TransitionPartialFulfillmentStatusInput,
} from '@/modules/orders/application/ports/partial-fulfillment-request-repository.port.js'
import type { OrderUnitOfWorkTx } from '@/modules/orders/application/ports/order-repository.port.js'
import { resolveDrizzleClient } from './drizzle-tx.util.js'

@Injectable()
export class DrizzlePartialFulfillmentRequestRepository implements PartialFulfillmentRequestRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async create(input: CreatePartialFulfillmentRequestInput, tx: OrderUnitOfWorkTx): Promise<PartialFulfillmentRequestRecord> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .insert(orderPartialFulfillmentRequests)
      .values({
        id: input.id,
        orderId: input.orderId,
        proposedBy: input.proposedBy,
        itemsSnapshot: input.itemsSnapshot,
        itemsTotalBeforeDiram: input.itemsTotalBeforeDiram,
        itemsTotalAfterDiram: input.itemsTotalAfterDiram,
        refundAmountDiram: input.refundAmountDiram,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
      })
      .returning()
    const row = rows[0]
    if (row === undefined) {
      throw new Error('DrizzlePartialFulfillmentRequestRepository.create: insert returned no row — invariant violation.')
    }
    return toRecord(row)
  }

  async findById(tenantId: string, requestId: string, tx?: OrderUnitOfWorkTx): Promise<PartialFulfillmentRequestRecord | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select({ request: orderPartialFulfillmentRequests })
      .from(orderPartialFulfillmentRequests)
      .innerJoin(orders, eq(orders.id, orderPartialFulfillmentRequests.orderId))
      .where(and(eq(orderPartialFulfillmentRequests.id, requestId), eq(orders.tenantId, tenantId)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return toRecord(row.request)
  }

  async transitionStatus(input: TransitionPartialFulfillmentStatusInput, tx: OrderUnitOfWorkTx): Promise<boolean> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .update(orderPartialFulfillmentRequests)
      .set({ status: input.toStatus, respondedAt: input.respondedAt })
      .where(
        and(
          eq(orderPartialFulfillmentRequests.id, input.id),
          eq(orderPartialFulfillmentRequests.status, input.fromStatus),
        ),
      )
      .returning({ id: orderPartialFulfillmentRequests.id })
    return rows.length > 0
  }
}

function toRecord(row: OrderPartialFulfillmentRequestRow): PartialFulfillmentRequestRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    proposedBy: row.proposedBy,
    itemsSnapshot: row.itemsSnapshot as readonly PartialFulfillmentSnapshotItemRecord[],
    itemsTotalBeforeDiram: row.itemsTotalBeforeDiram,
    itemsTotalAfterDiram: row.itemsTotalAfterDiram,
    refundAmountDiram: row.refundAmountDiram,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    requestedAt: row.requestedAt,
    expiresAt: row.expiresAt,
    respondedAt: row.respondedAt,
  }
}

export const PARTIAL_FULFILLMENT_REQUEST_REPOSITORY_DRIZZLE_PROVIDER = {
  provide: PARTIAL_FULFILLMENT_REQUEST_REPOSITORY,
  useClass: DrizzlePartialFulfillmentRequestRepository,
} as const
