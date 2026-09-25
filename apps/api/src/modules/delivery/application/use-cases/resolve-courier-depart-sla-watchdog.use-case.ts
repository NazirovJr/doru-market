// Идемпотентен: назначение уже не 'assigned' (курьер выехал / переназначено раньше таймера) -> no-op, не бросает.
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import type { DeliveryDomainEvent } from '../../domain/delivery-domain-event.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import { DELIVERY_UNIT_OF_WORK, type DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { resolveCourierDepartSlaMinutes } from './courier-depart-sla-timing.util.js'

export interface ResolveCourierDepartSlaWatchdogCommand {
  readonly deliveryAssignmentId: string
}

@Injectable()
export class ResolveCourierDepartSlaWatchdogUseCase {
  // eslint-disable-next-line max-params -- 4 DI-инъекции, явные @Inject
  public constructor(
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(cmd: ResolveCourierDepartSlaWatchdogCommand): Promise<void> {
    await this.uow.run(async (tx) => {
      const assignment = await this.assignments.findById(cmd.deliveryAssignmentId, tx)
      if (assignment?.status !== 'assigned') {
        return // курьер уже выехал / назначение переназначено раньше срабатывания таймера — idempotent no-op
      }
      const event: DeliveryDomainEvent = {
        type: 'SlaBreachedEvent',
        deliveryAssignmentId: assignment.id,
        orderId: assignment.orderId,
        entityType: 'delivery_assignment',
        entityId: assignment.id,
        breachedAt: this.clock.now(),
        slaMinutes: resolveCourierDepartSlaMinutes(),
      }
      await this.outbox.append(event, null, tx)
    })
  }
}
