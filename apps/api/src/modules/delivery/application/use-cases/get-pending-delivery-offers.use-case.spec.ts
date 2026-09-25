import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import { DeliveryOffer } from '../../domain/delivery-offer.entity.js'
import type { DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { PharmacyLocation, PharmacyLookupPort } from '../ports/pharmacy-lookup.port.js'
import { GetPendingDeliveryOffersUseCase } from './get-pending-delivery-offers.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const USER_ID = 'user-1'
const COURIER_ID = 'courier-1'
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'

function geo(): GeoPoint {
  const result = GeoPoint.create(38.5598, 68.787)
  if (!result.ok) throw new Error('fixture error')
  return result.value
}

function makeOffer(): DeliveryOffer {
  return DeliveryOffer.create({
    id: 'offer-1',
    deliveryAssignmentId: ASSIGNMENT_ID,
    courierId: COURIER_ID,
    sequenceNo: 1,
    distanceMeters: 500,
    score: 0.8,
    offeredAt: NOW,
    expiresAt: new Date(NOW.getTime() + 45_000),
  })
}

function makeAssignment(requiresColdChain: boolean): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    courierId: null,
    status: 'unassigned',
    landmarkText: null,
    handoverOtpId: null,
    cashCollectedDiram: null,
    cashChangeDiram: null,
    reassignReason: null,
    reassignedBy: null,
    assignedAt: null,
    pickedUpFromPharmacyAt: null,
    deliveredAt: null,
    failedReason: null,
    createdAt: NOW,
    requiresColdChain,
    coldChainBagConfirmed: null,
    coldChainBagConfirmedAt: null,
    contactAttemptsCount: 0,
    lastContactAttemptAt: null,
    distanceMeters: null,
  }
  return DeliveryAssignment.restore(snapshot)
}

describe('GetPendingDeliveryOffersUseCase', () => {
  it('SRS-DELIV-071: собирает pending офферы курьера в PendingOfferView с pharmacy/orderSummary, БЕЗ точного адреса клиента', async () => {
    const offers: DeliveryOfferRepositoryPort = {
      findById: vi.fn().mockResolvedValue(null),
      findByIdForUpdate: vi.fn().mockResolvedValue(null),
      findPendingByCourierId: vi.fn().mockResolvedValue([makeOffer()]),
      findByAssignmentId: vi.fn().mockResolvedValue([]),
      save: vi.fn(),
    }
    const assignments: DeliveryAssignmentRepositoryPort = {
      findById: vi.fn().mockResolvedValue(makeAssignment(true)),
      findActiveByOrderId: vi.fn().mockResolvedValue(null),
      findByOrderId: vi.fn().mockResolvedValue(null),
      hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
      save: vi.fn(),
    }
    const couriers: CourierRepositoryPort = {
      findById: vi.fn().mockResolvedValue(null),
      findByUserId: vi.fn().mockResolvedValue(
        Courier.create({ id: COURIER_ID, userId: USER_ID, chainId: null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW }),
      ),
      save: vi.fn(),
    }
    const orderContext: DeliveryOrderContext = {
      orderId: ORDER_ID,
      tenantId: 'tenant-1',
      pharmacyId: 'pharmacy-1',
      medicineIds: [],
      itemsCount: 3,
      paymentMethod: 'cash_courier',
      deliveryGeoPoint: null,
      deliveryFeeDiram: 1000n,
    }
    const orders: DeliveryOrdersPort = { getOrderForRating: vi.fn().mockResolvedValue(null), getDeliveryContext: vi.fn().mockResolvedValue(orderContext) }
    const pharmacyLocation: PharmacyLocation = { id: 'pharmacy-1', name: 'Pharmacy', addressText: 'Addr', geoPoint: geo(), chainId: null }
    const pharmacies: PharmacyLookupPort = { findById: vi.fn().mockResolvedValue(pharmacyLocation) }
    const useCase = new GetPendingDeliveryOffersUseCase(offers, assignments, couriers, orders, pharmacies)

    const [view] = await useCase.execute(USER_ID)

    expect(view).toBeDefined()
    expect(view?.id).toBe('offer-1')
    expect(view?.sequenceNo).toBe(1)
    expect(view?.pharmacy).toEqual({ name: 'Pharmacy', addressText: 'Addr', geoPoint: geo() })
    expect(view?.orderSummary).toEqual({ itemsCount: 3, requiresColdChain: true, paymentMethod: 'cash_courier', estimatedDeliveryFeeDiram: 1000 })
    // Явная проверка: только адрес АПТЕКИ, никакого customer-специфичного поля.
    expect(Object.keys(view ?? {})).not.toContain('customerAddress')
  })

  it('актор не найден как курьер -> NotFoundError', async () => {
    const offers: DeliveryOfferRepositoryPort = {
      findById: vi.fn(),
      findByIdForUpdate: vi.fn(),
      findPendingByCourierId: vi.fn(),
      findByAssignmentId: vi.fn(),
      save: vi.fn(),
    }
    const assignments: DeliveryAssignmentRepositoryPort = {
      findById: vi.fn(),
      findActiveByOrderId: vi.fn(),
      findByOrderId: vi.fn(),
      hasActiveAssignmentForCourier: vi.fn(),
      save: vi.fn(),
    }
    const couriers: CourierRepositoryPort = { findById: vi.fn(), findByUserId: vi.fn().mockResolvedValue(null), save: vi.fn() }
    const orders: DeliveryOrdersPort = { getOrderForRating: vi.fn(), getDeliveryContext: vi.fn() }
    const pharmacies: PharmacyLookupPort = { findById: vi.fn() }
    const useCase = new GetPendingDeliveryOffersUseCase(offers, assignments, couriers, orders, pharmacies)

    await expect(useCase.execute(USER_ID)).rejects.toBeInstanceOf(NotFoundError)
  })
})
