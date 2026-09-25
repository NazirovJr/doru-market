import type { PendingOfferView } from '../application/use-cases/get-pending-delivery-offers.use-case.js'

export interface PendingOfferDto {
  readonly id: string
  readonly deliveryAssignmentId: string
  readonly sequenceNo: number
  readonly distanceMeters: number
  readonly expiresAt: Date
  readonly pharmacy: { readonly name: string; readonly addressText: string; readonly geoPoint: { readonly lat: number; readonly lon: number } }
  readonly orderSummary: {
    readonly itemsCount: number
    readonly requiresColdChain: boolean
    readonly paymentMethod: string
    readonly estimatedDeliveryFeeDiram: number
  }
}

export function toPendingOfferDto(view: PendingOfferView): PendingOfferDto {
  return {
    id: view.id,
    deliveryAssignmentId: view.deliveryAssignmentId,
    sequenceNo: view.sequenceNo,
    distanceMeters: view.distanceMeters,
    expiresAt: view.expiresAt,
    pharmacy: {
      name: view.pharmacy.name,
      addressText: view.pharmacy.addressText,
      geoPoint: { lat: view.pharmacy.geoPoint.latitude, lon: view.pharmacy.geoPoint.longitude },
    },
    orderSummary: view.orderSummary,
  }
}
