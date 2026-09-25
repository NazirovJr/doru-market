// TC-DELIV-071: SELECT ... FOR UPDATE на delivery_offers, 1:1 приём AcceptOrderUseCase.findByIdForUpdate.
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import type { DeliveryDomainEvent } from '../../domain/delivery-domain-event.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { DELIVERY_OFFER_REPOSITORY, type DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import { PHARMACY_LOOKUP_PORT, type PharmacyLookupPort } from '../ports/pharmacy-lookup.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import { DELIVERY_UNIT_OF_WORK, type DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import {
  DELIVERY_OFFER_TIMEOUT_QUEUE,
  type DeliveryOfferTimeoutQueuePort,
} from '../ports/delivery-offer-timeout-queue.port.js'

export interface AcceptDeliveryOfferCommand {
  readonly offerId: string
  readonly userId: string
}

export interface AcceptDeliveryOfferResult {
  readonly deliveryAssignmentId: string
}

@Injectable()
export class AcceptDeliveryOfferUseCase {
  // eslint-disable-next-line max-params -- 9 DI-инъекций, явные @Inject (DTJ-001)
  public constructor(
    @Inject(DELIVERY_OFFER_REPOSITORY) private readonly offers: DeliveryOfferRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(PHARMACY_LOOKUP_PORT) private readonly pharmacies: PharmacyLookupPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(DELIVERY_OFFER_TIMEOUT_QUEUE) private readonly timeoutQueue: DeliveryOfferTimeoutQueuePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(cmd: AcceptDeliveryOfferCommand): Promise<AcceptDeliveryOfferResult> {
    const courier = await this.couriers.findByUserId(cmd.userId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', userId: cmd.userId })
    }
    return this.uow.run(async (tx) => {
      const offer = await this.offers.findByIdForUpdate(cmd.offerId, tx)
      if (offer === null) {
        throw new NotFoundError({ resource: 'delivery_offer', offerId: cmd.offerId })
      }
      if (offer.courierId !== courier.id) {
        throw new ForbiddenError('Offer does not belong to this courier', { offerId: cmd.offerId })
      }
      const now = this.clock.now()
      offer.accept(now) // OfferAlreadyRespondedError / OfferExpiredError — сама сущность (TC-DELIV-002/071)
      await this.offers.save(offer, tx)

      const assignment = await this.assignments.findById(offer.deliveryAssignmentId, tx)
      if (assignment === null) {
        throw new NotFoundError({ resource: 'delivery_assignment', assignmentId: offer.deliveryAssignmentId })
      }
      const orderPharmacyChainId = await this.resolveOrderPharmacyChainId(assignment.orderId)
      assignment.assign({ courier: courier.toEligibilitySnapshot(), orderPharmacyChainId, now })
      await this.assignments.save(assignment, tx)

      await this.timeoutQueue.cancel(offer.id)

      const event: DeliveryDomainEvent = {
        type: 'CourierAssignedEvent',
        deliveryAssignmentId: assignment.id,
        orderId: assignment.orderId,
        courierId: courier.id,
        assignedAt: now,
      }
      await this.outbox.append(event, null, tx)
      return { deliveryAssignmentId: assignment.id }
    })
  }

  private async resolveOrderPharmacyChainId(orderId: string): Promise<string | null> {
    const orderContext = await this.orders.getDeliveryContext(orderId)
    if (orderContext === null) {
      throw new NotFoundError({ resource: 'order', orderId })
    }
    const pharmacy = await this.pharmacies.findById(orderContext.pharmacyId)
    return pharmacy?.chainId ?? null
  }
}
