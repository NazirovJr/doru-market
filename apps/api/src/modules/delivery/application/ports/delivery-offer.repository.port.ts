import type { DeliveryOffer } from '../../domain/delivery-offer.entity.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const DELIVERY_OFFER_REPOSITORY = Symbol.for('@dorutj/delivery/delivery-offer-repository')

export interface DeliveryOfferRepositoryPort {
  findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryOffer | null>
  /** TC-DELIV-071 — `SELECT ... FOR UPDATE`, сериализует конкурентный `accept`. `tx` обязателен. */
  findByIdForUpdate(id: string, tx: DeliveryUnitOfWorkTx): Promise<DeliveryOffer | null>
  findPendingByCourierId(courierId: string, tx?: DeliveryUnitOfWorkTx): Promise<readonly DeliveryOffer[]>
  findByAssignmentId(assignmentId: string, tx?: DeliveryUnitOfWorkTx): Promise<readonly DeliveryOffer[]>
  save(offer: DeliveryOffer, tx?: DeliveryUnitOfWorkTx): Promise<void>
}
