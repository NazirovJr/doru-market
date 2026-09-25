import type { Courier } from '../../domain/courier.entity.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const COURIER_REPOSITORY = Symbol.for('@dorutj/delivery/courier-repository')

export interface CourierRepositoryPort {
  findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<Courier | null>
  findByUserId(userId: string, tx?: DeliveryUnitOfWorkTx): Promise<Courier | null>
  save(courier: Courier, tx?: DeliveryUnitOfWorkTx): Promise<void>
}
