import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import {
  DELIVERY_OUTBOX,
  type DeliveryOutboxPort,
} from '@/modules/delivery/application/ports/delivery-outbox.port.js'
import type { DeliveryDomainEvent } from '@/modules/delivery/domain/delivery-domain-event.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

const AGGREGATE_TYPE_DELIVERY_ASSIGNMENT = 'delivery_assignment'
const AGGREGATE_TYPE_COURIER_SHIFT = 'courier_shift'
const AGGREGATE_TYPE_COURIER_RATING = 'courier_rating'

interface AggregateRef {
  readonly aggregateType: string
  readonly aggregateId: string
}

@Injectable()
export class DrizzleDeliveryOutboxAdapter implements DeliveryOutboxPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async append(event: DeliveryDomainEvent, tenantId: string | null, tx: DeliveryUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const { aggregateType, aggregateId } = resolveAggregateRef(event)
    await client.insert(outbox).values({
      eventType: event.type,
      aggregateType,
      aggregateId,
      payload: toJsonSafePayload(event),
      tenantId,
    })
  }
}

// outbox.payload — jsonb, JSON.stringify не умеет bigint -> сериализуем в строку явно
function toJsonSafePayload(event: DeliveryDomainEvent): Record<string, unknown> {
  if (event.type === 'CashReconciliationDiscrepancyEvent') {
    return { ...event, discrepancyDiram: event.discrepancyDiram.toString() }
  }
  return { ...event }
}

function resolveAggregateRef(event: DeliveryDomainEvent): AggregateRef {
  switch (event.type) {
    case 'DeliveryOfferCreatedEvent':
    case 'DeliveryOfferExpiredEvent':
    case 'DeliveryEscalatedToPoolEvent':
    case 'DeliveryFailedEvent':
    case 'OrderRefusedAtDoorEvent':
    case 'CourierAssignedEvent':
      return { aggregateType: AGGREGATE_TYPE_DELIVERY_ASSIGNMENT, aggregateId: event.deliveryAssignmentId }
    case 'CashReconciliationDiscrepancyEvent':
      return { aggregateType: AGGREGATE_TYPE_COURIER_SHIFT, aggregateId: event.courierShiftId }
    case 'CourierRatedEvent':
      return { aggregateType: AGGREGATE_TYPE_COURIER_RATING, aggregateId: event.orderId }
    default:
      return assertUnreachable(event)
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`DeliveryDomainEvent: unhandled event type ${JSON.stringify(value)}`)
}

export const DELIVERY_OUTBOX_PROVIDER = {
  provide: DELIVERY_OUTBOX,
  useClass: DrizzleDeliveryOutboxAdapter,
} as const
