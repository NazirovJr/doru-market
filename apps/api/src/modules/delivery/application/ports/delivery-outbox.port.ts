import type { DeliveryDomainEvent } from '../../domain/delivery-domain-event.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const DELIVERY_OUTBOX = Symbol.for('@dorutj/delivery/outbox')

export interface DeliveryOutboxPort {
  append(event: DeliveryDomainEvent, tenantId: string | null, tx: DeliveryUnitOfWorkTx): Promise<void>
}
