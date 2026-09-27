import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
} from '../ports/delivery-unit-of-work.port.js'
import {
  COURIER_DEPART_SLA_WATCHDOG_QUEUE,
  type CourierDepartSlaWatchdogQueuePort,
} from '../ports/courier-depart-sla-watchdog-queue.port.js'

export interface DepartCommand {
  readonly assignmentId: string
  readonly userId: string
}

export interface DepartResult {
  readonly deliveryAssignmentId: string
}

// Отменяет CourierDepartSlaWatchdogQueue — иначе таймер опубликует ложный SlaBreachedEvent.
@Injectable()
export class DepartUseCase {
  // eslint-disable-next-line max-params -- 4 DI-инъекции, явные @Inject
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(COURIER_DEPART_SLA_WATCHDOG_QUEUE) private readonly watchdog: CourierDepartSlaWatchdogQueuePort,
  ) {}

  public async execute(cmd: DepartCommand): Promise<DepartResult> {
    const courier = await this.couriers.findByUserId(cmd.userId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', userId: cmd.userId })
    }
    await this.uow.run(async (tx) => {
      const assignment = await this.assignments.findById(cmd.assignmentId, tx)
      if (assignment === null) {
        throw new NotFoundError({ resource: 'delivery_assignment', assignmentId: cmd.assignmentId })
      }
      if (assignment.courierId !== courier.id) {
        throw new ForbiddenError('Delivery assignment does not belong to this courier', { assignmentId: cmd.assignmentId })
      }
      assignment.depart() // ForbiddenTransitionError, если статус не assigned (state-machine)
      await this.assignments.save(assignment, tx)
    })
    await this.watchdog.cancel(cmd.assignmentId)
    return { deliveryAssignmentId: cmd.assignmentId }
  }
}
