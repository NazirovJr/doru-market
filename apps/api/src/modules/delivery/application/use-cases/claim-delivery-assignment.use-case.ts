// claim(): условный UPDATE (claimUnassigned), не SELECT FOR UPDATE + save().
import { Inject, Injectable } from '@nestjs/common'
import { AssignmentAlreadyClaimedError, CourierNotOnShiftError, NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import type { DeliveryDomainEvent } from '../../domain/delivery-domain-event.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import { PHARMACY_LOOKUP_PORT, type PharmacyLookupPort } from '../ports/pharmacy-lookup.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import { DELIVERY_UNIT_OF_WORK, type DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import {
  COURIER_DEPART_SLA_WATCHDOG_QUEUE,
  type CourierDepartSlaWatchdogQueuePort,
} from '../ports/courier-depart-sla-watchdog-queue.port.js'
import { resolveCourierDepartSlaMinutes } from './courier-depart-sla-timing.util.js'

export interface ClaimDeliveryAssignmentCommand {
  readonly assignmentId: string
  readonly userId: string
}

export interface ClaimDeliveryAssignmentResult {
  readonly deliveryAssignmentId: string
}

@Injectable()
export class ClaimDeliveryAssignmentUseCase {
  // eslint-disable-next-line max-params -- 8 DI-инъекций, явные @Inject
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(PHARMACY_LOOKUP_PORT) private readonly pharmacies: PharmacyLookupPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(COURIER_DEPART_SLA_WATCHDOG_QUEUE) private readonly watchdog: CourierDepartSlaWatchdogQueuePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(cmd: ClaimDeliveryAssignmentCommand): Promise<ClaimDeliveryAssignmentResult> {
    const courier = await this.couriers.findByUserId(cmd.userId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', userId: cmd.userId })
    }
    if (courier.shiftStatus !== 'on_shift') {
      throw new CourierNotOnShiftError({ courierId: courier.id })
    }
    const assignment = await this.assignments.findById(cmd.assignmentId)
    if (assignment === null) {
      throw new NotFoundError({ resource: 'delivery_assignment', assignmentId: cmd.assignmentId })
    }
    if (assignment.status !== 'unassigned') {
      throw new AssignmentAlreadyClaimedError({ assignmentId: cmd.assignmentId })
    }
    const orderPharmacyChainId = await this.resolveOrderPharmacyChainId(assignment.orderId)
    const now = this.clock.now()
    // Guard-валидация через assign() (не персистится) — запись только через claimUnassigned().
    assignment.assign({ courier: courier.toEligibilitySnapshot(), orderPharmacyChainId, now })

    return this.uow.run(async (tx) => {
      const claimed = await this.assignments.claimUnassigned({ id: cmd.assignmentId, courierId: courier.id, now }, tx)
      if (!claimed) {
        throw new AssignmentAlreadyClaimedError({ assignmentId: cmd.assignmentId })
      }
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

  private async resolveOrderPharmacyChainId(orderId: string): Promise<string | null> {
    const orderContext = await this.orders.getDeliveryContext(orderId)
    if (orderContext === null) {
      throw new NotFoundError({ resource: 'order', orderId })
    }
    const pharmacy = await this.pharmacies.findById(orderContext.pharmacyId)
    return pharmacy?.chainId ?? null
  }
}
