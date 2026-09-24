/**
 * `StartCourierShiftUseCase` (EP-13, DTJ-320, SRS-DELIV-028) — `POST /api/v1/courier-shifts`.
 *
 * `userId` (не `courierId`) — параметр входа: JWT несёт только `sub` (userId, см. JSDoc
 * `courier.repository.port.ts`, DTJ-314) — use case сам резолвит действующего курьера.
 *
 * `opening_cash_on_hand_diram = couriers.current_cash_on_hand_diram` (перенос остатка с прошлой
 * смены, если инкассация не была полной, текст тикета п.1) — читается с `Courier`, НЕ с прошлой
 * `CourierShift` (та может не существовать вовсе — первая смена курьера).
 *
 * `hasActiveShift` вычисляется ВНУТРИ той же транзакции, что запись новой смены — 1:1 приём
 * `DeliveryFacade.createAssignment` (DTJ-314: pre-check + `ux_courier_shifts_one_active` как
 * backstop БД на гонке; строгая сериализация здесь не заводится — тот же риск-профиль, что уже
 * принят кодовой базой для `DeliveryAssignment.create()`).
 */
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
  // eslint-disable-next-line max-params -- 5 DI-инъекций, тот же приём, что `checkout.use-case.ts`.
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
