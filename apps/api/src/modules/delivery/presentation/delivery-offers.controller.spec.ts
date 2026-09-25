import { describe, expect, it, vi } from 'vitest'
import type { JwtClaims } from '@/modules/auth/index.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { GetPendingDeliveryOffersUseCase, PendingOfferView } from '../application/use-cases/get-pending-delivery-offers.use-case.js'
import type { AcceptDeliveryOfferUseCase } from '../application/use-cases/accept-delivery-offer.use-case.js'
import type { DeclineDeliveryOfferUseCase } from '../application/use-cases/decline-delivery-offer.use-case.js'
import { DeliveryOffersController } from './delivery-offers.controller.js'

const COURIER_CLAIMS: JwtClaims = { sub: 'user-1', role: 'courier', tenantId: 'tenant-1', pharmacyId: null, chainId: null, sessionId: 's-1' }

function geo(): GeoPoint {
  const result = GeoPoint.create(38.5598, 68.787)
  if (!result.ok) throw new Error('fixture error')
  return result.value
}

function makeView(): PendingOfferView {
  return {
    id: 'offer-1',
    deliveryAssignmentId: 'assignment-1',
    sequenceNo: 1,
    distanceMeters: 500,
    expiresAt: new Date('2026-09-25T10:00:45.000Z'),
    pharmacy: { name: 'Pharmacy', addressText: 'Addr', geoPoint: geo() },
    orderSummary: { itemsCount: 2, requiresColdChain: false, paymentMethod: 'cash_courier', estimatedDeliveryFeeDiram: 1000 },
  }
}

describe('DeliveryOffersController', () => {
  it('list: делегирует GetPendingDeliveryOffersUseCase.execute(userId из JWT), маппит GeoPoint -> {lat, lon}', async () => {
    const getPendingExecute = vi.fn().mockResolvedValue([makeView()])
    const getPending = { execute: getPendingExecute } as unknown as GetPendingDeliveryOffersUseCase
    const controller = new DeliveryOffersController(getPending, {} as AcceptDeliveryOfferUseCase, {} as DeclineDeliveryOfferUseCase)

    const response = await controller.list(COURIER_CLAIMS, 'pending')

    expect(getPendingExecute).toHaveBeenCalledWith('user-1')
    expect(response.data[0]?.pharmacy.geoPoint).toEqual({ lat: 38.5598, lon: 68.787 })
  })

  it('acceptOffer: делегирует AcceptDeliveryOfferUseCase.execute({offerId, userId})', async () => {
    const acceptExecute = vi.fn().mockResolvedValue({ deliveryAssignmentId: 'assignment-1' })
    const accept = { execute: acceptExecute } as unknown as AcceptDeliveryOfferUseCase
    const controller = new DeliveryOffersController({} as GetPendingDeliveryOffersUseCase, accept, {} as DeclineDeliveryOfferUseCase)

    const response = await controller.acceptOffer('offer-1', COURIER_CLAIMS)

    expect(acceptExecute).toHaveBeenCalledWith({ offerId: 'offer-1', userId: 'user-1' })
    expect(response.data).toEqual({ deliveryAssignmentId: 'assignment-1' })
  })

  it('declineOffer: делегирует DeclineDeliveryOfferUseCase.execute с reason=null, если тело пустое', async () => {
    const declineExecute = vi.fn().mockResolvedValue(undefined)
    const decline = { execute: declineExecute } as unknown as DeclineDeliveryOfferUseCase
    const controller = new DeliveryOffersController({} as GetPendingDeliveryOffersUseCase, {} as AcceptDeliveryOfferUseCase, decline)

    await controller.declineOffer('offer-1', COURIER_CLAIMS, {})

    expect(declineExecute).toHaveBeenCalledWith({ offerId: 'offer-1', userId: 'user-1', reason: null })
  })
})
