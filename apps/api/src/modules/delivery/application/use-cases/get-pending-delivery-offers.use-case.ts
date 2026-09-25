// Точный адрес клиента НЕ раскрывается здесь (минимизация утечки ПДн) — только адрес аптеки.
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import type { GeoPoint } from '@/shared-kernel/index.js'
import type { DeliveryOffer } from '../../domain/delivery-offer.entity.js'
import { DELIVERY_OFFER_REPOSITORY, type DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import { PHARMACY_LOOKUP_PORT, type PharmacyLookupPort } from '../ports/pharmacy-lookup.port.js'
import { DeliveryFacade } from '../delivery.facade.js'

export interface PendingOfferView {
  readonly id: string
  readonly deliveryAssignmentId: string
  readonly sequenceNo: number
  readonly distanceMeters: number
  readonly expiresAt: Date
  readonly pharmacy: { readonly name: string; readonly addressText: string; readonly geoPoint: GeoPoint }
  readonly orderSummary: {
    readonly itemsCount: number
    readonly requiresColdChain: boolean
    readonly paymentMethod: string
    readonly estimatedDeliveryFeeDiram: number
  }
}

@Injectable()
export class GetPendingDeliveryOffersUseCase {
  // eslint-disable-next-line max-params -- 5 DI-инъекций, явные @Inject (DTJ-001)
  public constructor(
    @Inject(DELIVERY_OFFER_REPOSITORY) private readonly offers: DeliveryOfferRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(PHARMACY_LOOKUP_PORT) private readonly pharmacies: PharmacyLookupPort,
    @Inject(DeliveryFacade) private readonly deliveryFacade: DeliveryFacade,
  ) {}

  public async execute(userId: string): Promise<readonly PendingOfferView[]> {
    const courier = await this.couriers.findByUserId(userId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', userId })
    }
    const pending = await this.offers.findPendingByCourierId(courier.id)
    return Promise.all(pending.map((offer) => this.toView(offer)))
  }

  private async toView(offer: DeliveryOffer): Promise<PendingOfferView> {
    const assignment = await this.assignments.findById(offer.deliveryAssignmentId)
    if (assignment === null) {
      throw new NotFoundError({ resource: 'delivery_assignment', assignmentId: offer.deliveryAssignmentId })
    }
    const orderContext = await this.orders.getDeliveryContext(assignment.orderId)
    if (orderContext === null) {
      throw new NotFoundError({ resource: 'order', orderId: assignment.orderId })
    }
    const pharmacy = await this.pharmacies.findById(orderContext.pharmacyId)
    if (pharmacy === null) {
      throw new NotFoundError({ resource: 'pharmacy', pharmacyId: orderContext.pharmacyId })
    }
    const deliveryGeoPoint = orderContext.deliveryGeoPoint ?? pharmacy.geoPoint
    const feeDiram = await this.deliveryFacade.calculateDeliveryFee(pharmacy.geoPoint, deliveryGeoPoint)
    return {
      id: offer.id,
      deliveryAssignmentId: offer.deliveryAssignmentId,
      sequenceNo: offer.sequenceNo,
      distanceMeters: offer.distanceMeters,
      expiresAt: offer.expiresAt,
      pharmacy: { name: pharmacy.name, addressText: pharmacy.addressText, geoPoint: pharmacy.geoPoint },
      orderSummary: {
        itemsCount: orderContext.itemsCount,
        requiresColdChain: assignment.toSnapshot().requiresColdChain,
        paymentMethod: orderContext.paymentMethod,
        estimatedDeliveryFeeDiram: Number(feeDiram),
      },
    }
  }
}
