import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import type { DeliveryDomainEvent } from '../../domain/delivery-domain-event.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import { DELIVERY_UNIT_OF_WORK, type DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import {
  COURIER_DEPART_SLA_WATCHDOG_QUEUE,
  type CourierDepartSlaWatchdogQueuePort,
} from '../ports/courier-depart-sla-watchdog-queue.port.js'
import { resolveCourierDepartSlaMinutes } from './courier-depart-sla-timing.util.js'
import { assertCourierInDispatcherScope, type DispatcherActor } from './assign-manual.use-case.js'

export interface ReassignDeliveryCommand {
  readonly assignmentId: string
  readonly newCourierId: string
  readonly reason: string
  readonly actor: DispatcherActor
}

export interface ReassignDeliveryResult {
  readonly deliveryAssignmentId: string
}

@Injectable()
export class ReassignDeliveryUseCase {
  // eslint-disable-next-line max-params -- 6 DI-инъекций, явные @Inject
  public constructor(
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(COURIER_DEPART_SLA_WATCHDOG_QUEUE) private readonly watchdog: CourierDepartSlaWatchdogQueuePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(cmd: ReassignDeliveryCommand): Promise<ReassignDeliveryResult> {
    const assignment = await this.assignments.findById(cmd.assignmentId)
    if (assignment === null) {
      throw new NotFoundError({ resource: 'delivery_assignment', assignmentId: cmd.assignmentId })
    }
    const courier = await this.couriers.findById(cmd.newCourierId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', courierId: cmd.newCourierId })
    }
    assertCourierInDispatcherScope(cmd.actor, courier.chainId)

    const now = this.clock.now()
    assignment.reassign({ newCourierId: courier.id, courierStatus: courier.status, reason: cmd.reason, reassignedBy: cmd.actor.userId, now })

    return this.uow.run(async (tx) => {
      await this.assignments.save(assignment, tx)
      const event: DeliveryDomainEvent = {
        type: 'CourierAssignedEvent',
        deliveryAssignmentId: cmd.assignmentId,
        orderId: assignment.orderId,
        courierId: courier.id,
        assignedAt: now,
      }
      await this.outbox.append(event, null, tx)
      // jobId переиспользуется — старый таймер отменяется до нового schedule().
      await this.watchdog.cancel(cmd.assignmentId)
      await this.watchdog.schedule({ deliveryAssignmentId: cmd.assignmentId, delayMinutes: resolveCourierDepartSlaMinutes() })
      return { deliveryAssignmentId: cmd.assignmentId }
    })
  }
}
