import type { CourierShift } from '../../domain/courier-shift.entity.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const COURIER_SHIFT_REPOSITORY = Symbol.for('@dorutj/delivery/courier-shift-repository')

export interface CourierShiftRepositoryPort {
  findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<CourierShift | null>
  findActiveByCourierId(courierId: string, tx?: DeliveryUnitOfWorkTx): Promise<CourierShift | null>
  save(shift: CourierShift, tx?: DeliveryUnitOfWorkTx): Promise<void>
}
