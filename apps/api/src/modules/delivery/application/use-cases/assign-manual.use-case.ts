import { Inject, Injectable } from '@nestjs/common'
import { AssignmentAlreadyClaimedError, ForbiddenError, NotFoundError, type UserRole } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import type { DeliveryDomainEvent } from '../../domain/delivery-domain-event.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { DELIVERY_OFFER_REPOSITORY, type DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import { PHARMACY_LOOKUP_PORT, type PharmacyLookupPort } from '../ports/pharmacy-lookup.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
  type DeliveryUnitOfWorkTx,
} from '../ports/delivery-unit-of-work.port.js'
import {
  COURIER_DEPART_SLA_WATCHDOG_QUEUE,
  type CourierDepartSlaWatchdogQueuePort,
} from '../ports/courier-depart-sla-watchdog-queue.port.js'
import { resolveCourierDepartSlaMinutes } from './courier-depart-sla-timing.util.js'

export interface DispatcherActor {
  readonly userId: string
  readonly role: UserRole
  readonly chainId: string | null
}

// pharmacy_admin — только свой флот; courier.chainId=null (платформенный пул) ему недоступен, только super_admin.
export function assertCourierInDispatcherScope(actor: DispatcherActor, courierChainId: string | null): void {
  if (actor.role === 'super_admin') {
    return
  }
  if (courierChainId === null || courierChainId !== actor.chainId) {
    throw new ForbiddenError('pharmacy_admin may only assign couriers from their own fleet', {
      courierChainId,
      actorChainId: actor.chainId,
    })
  }
}

// reason валидируется на границе API, но не персистится — reassign_reason/reassigned_by принадлежат только reassign().
export interface AssignManualCommand {
  readonly assignmentId: string
  readonly courierId: string
  readonly reason?: string | undefined
  readonly actor: DispatcherActor
}

export interface AssignManualResult {
  readonly deliveryAssignmentId: string
}

@Injectable()
export class AssignManualUseCase {
  // eslint-disable-next-line max-params -- 9 DI-инъекций, явные @Inject
  public constructor(
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_OFFER_REPOSITORY) private readonly offers: DeliveryOfferRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(PHARMACY_LOOKUP_PORT) private readonly pharmacies: PharmacyLookupPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(COURIER_DEPART_SLA_WATCHDOG_QUEUE) private readonly watchdog: CourierDepartSlaWatchdogQueuePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(cmd: AssignManualCommand): Promise<AssignManualResult> {
    const assignment = await this.assignments.findById(cmd.assignmentId)
    if (assignment === null) {
      throw new NotFoundError({ resource: 'delivery_assignment', assignmentId: cmd.assignmentId })
    }
    const courier = await this.couriers.findById(cmd.courierId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', courierId: cmd.courierId })
    }
    assertCourierInDispatcherScope(cmd.actor, courier.chainId)

    const orderPharmacyChainId = await this.resolveOrderPharmacyChainId(assignment.orderId)
    const now = this.clock.now()
    assignment.assign({ courier: courier.toEligibilitySnapshot(), orderPharmacyChainId, now })

    return this.uow.run(async (tx) => {
      const assigned = await this.assignments.assignManual({ id: cmd.assignmentId, courierId: courier.id, now }, tx)
      if (!assigned) {
        throw new AssignmentAlreadyClaimedError({ assignmentId: cmd.assignmentId })
      }
      await this.supersedePendingOffers(cmd.assignmentId, now, tx)
      const event: DeliveryDomainEvent = {
        type: 'CourierAssignedEvent',
        deliveryAssignmentId: cmd.assignmentId,
        orderId: assignment.orderId,
        courierId: courier.id,
        assignedAt: now,
      }
      await this.outbox.append(event, null, tx)
      await this.watchdog.schedule({ deliveryAssignmentId: cmd.assignmentId, delayMinutes: resolveCourierDepartSlaMinutes() })
      return { deliveryAssignmentId: cmd.assignmentId }
    })
  }

  private async supersedePendingOffers(assignmentId: string, now: Date, tx: DeliveryUnitOfWorkTx): Promise<void> {
    const existingOffers = await this.offers.findByAssignmentId(assignmentId, tx)
    for (const offer of existingOffers) {
      if (offer.status === 'pending') {
        offer.supersede(now)
        // eslint-disable-next-line no-await-in-loop -- одна транзакция/соединение, последовательная запись
        await this.offers.save(offer, tx)
      }
    }
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
