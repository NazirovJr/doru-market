/**
 * `CourierShiftRepositoryPort` (EP-13, DTJ-320). Файл СВЕРХ буквального `files_owned` DTJ-320
 * (тот же приём, что `courier.repository.port.ts`/`delivery-assignment.repository.port.ts`,
 * DTJ-314, JSDoc того файла) — `StartCourierShiftUseCase`/`EndCourierShiftUseCase` не могут
 * выполнить свою работу без доступа к `courier_shifts` (`02` §1.3: порт в application,
 * реализация в infrastructure).
 *
 * `findActiveByCourierId` — источник истины для «есть уже активная смена» (SRS-DELIV-006, 1:1
 * частичный уникальный индекс `ux_courier_shifts_one_active`, `db/schema/courier-shifts.ts`):
 * `status = 'active'`. Ровно одна активная смена на курьера — использовано и `StartCourierShiftUseCase`
 * (409 `ShiftAlreadyActiveError`), и как источник `opening_cash_on_hand_diram` НЕ отсюда (это поле
 * берётся из `couriers.current_cash_on_hand_diram`, см. JSDoc use case'а).
 */
import type { CourierShift } from '../../domain/courier-shift.entity.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const COURIER_SHIFT_REPOSITORY = Symbol.for('@dorutj/delivery/courier-shift-repository')

export interface CourierShiftRepositoryPort {
  findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<CourierShift | null>
  /** Активная (`status='active'`) смена курьера, либо `null` — 1:1 `ux_courier_shifts_one_active`. */
  findActiveByCourierId(courierId: string, tx?: DeliveryUnitOfWorkTx): Promise<CourierShift | null>
  save(shift: CourierShift, tx?: DeliveryUnitOfWorkTx): Promise<void>
}
