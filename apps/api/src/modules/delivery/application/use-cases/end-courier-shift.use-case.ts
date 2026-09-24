import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { CourierShiftSnapshot } from '../../domain/courier-shift.entity.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import {
  COURIER_SHIFT_REPOSITORY,
  type CourierShiftRepositoryPort,
} from '../ports/courier-shift.repository.port.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
} from '../ports/delivery-unit-of-work.port.js'

export type { CourierShiftSnapshot }

export interface EndCourierShiftInput {
  readonly userId: string
  readonly shiftId: string
  readonly cashSubmittedDiram: bigint
}

@Injectable()
export class EndCourierShiftUseCase {
  // eslint-disable-next-line max-params -- 6 DI-инъекций конструктора
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(COURIER_SHIFT_REPOSITORY) private readonly shifts: CourierShiftRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(input: EndCourierShiftInput): Promise<CourierShiftSnapshot> {
    return this.uow.run(async (tx) => {
      const courier = await this.couriers.findByUserId(input.userId, tx)
      if (courier === null) {
        throw new NotFoundError({ userId: input.userId })
      }
      const shift = await this.shifts.findById(input.shiftId, tx)
      if (shift === null) {
        throw new NotFoundError({ shiftId: input.shiftId })
      }
      if (shift.courierId !== courier.id) {
        throw new ForbiddenError('Shift does not belong to the requesting courier', { shiftId: input.shiftId })
      }
      const hasActiveAssignment = await this.assignments.hasActiveAssignmentForCourier(courier.id, tx)
      shift.close({
        cashSubmittedDiram: Money.fromDiram(input.cashSubmittedDiram),
        hasActiveAssignment,
        closedBy: null,
        now: this.clock.now(),
      })
      const updatedCourier = courier.goOffShift().settleCashOnHand()
      await this.shifts.save(shift, tx)
      await this.couriers.save(updatedCourier, tx)
      for (const event of shift.pullDomainEvents()) {
        // eslint-disable-next-line no-await-in-loop -- одна транзакция/соединение, порядок важен
        await this.outbox.append(event, null, tx)
      }
      return shift.toSnapshot()
    })
  }
}
