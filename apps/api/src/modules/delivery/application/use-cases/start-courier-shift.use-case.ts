import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { CourierShift } from '../../domain/courier-shift.entity.js'
import type { CourierShiftSnapshot } from '../../domain/courier-shift.entity.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import {
  COURIER_SHIFT_REPOSITORY,
  type CourierShiftRepositoryPort,
} from '../ports/courier-shift.repository.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
} from '../ports/delivery-unit-of-work.port.js'

@Injectable()
export class StartCourierShiftUseCase {
  // eslint-disable-next-line max-params -- 5 DI-инъекций конструктора
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(COURIER_SHIFT_REPOSITORY) private readonly shifts: CourierShiftRepositoryPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(userId: string): Promise<CourierShiftSnapshot> {
    return this.uow.run(async (tx) => {
      const courier = await this.couriers.findByUserId(userId, tx)
      if (courier === null) {
        throw new NotFoundError({ userId })
      }
      const activeShift = await this.shifts.findActiveByCourierId(courier.id, tx)
      // остаток переносится с Courier, не с прошлой смены — та могла не существовать вовсе
      const shift = CourierShift.start({
        id: this.ids.next(),
        courierId: courier.id,
        openingCashOnHandDiram: courier.currentCashOnHandDiram,
        hasActiveShift: activeShift !== null,
        now: this.clock.now(),
      })
      const updatedCourier = courier.goOnShift()
      await this.shifts.save(shift, tx)
      await this.couriers.save(updatedCourier, tx)
      return shift.toSnapshot()
    })
  }
}
