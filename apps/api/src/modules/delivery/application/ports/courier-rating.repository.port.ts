import type { CourierRating } from '../../domain/courier-rating.entity.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const COURIER_RATING_REPOSITORY = Symbol.for('@dorutj/delivery/courier-rating-repository')

export interface CourierRatingRepositoryPort {
  existsByOrderId(orderId: string, tx?: DeliveryUnitOfWorkTx): Promise<boolean>
  save(rating: CourierRating, tx?: DeliveryUnitOfWorkTx): Promise<void>
}
