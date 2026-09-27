import { describe, expect, it, vi } from 'vitest'
import { CourierNotOnShiftError, NotFoundError } from '@dorutj/contracts'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { PharmacyLookupPort, PharmacyLocation } from '../ports/pharmacy-lookup.port.js'
import { GetAvailableDeliveryPoolUseCase } from './get-available-delivery-pool.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const USER_ID = 'user-1'
const COURIER_ID = 'courier-1'
const COURIER_LAT = 38.5598
const COURIER_LON = 68.787
const NEAR_LAT = 38.5698
const FAR_LAT = 39.05

function makeAssignment(id: string, requiresColdChain = false): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id,
    orderId: `order-${id}`,
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
    proofPhotoUrl: null,
  }
  return DeliveryAssignment.restore(snapshot)
}

function makeCourier(overrides: { chainId?: string | null; hasLocation?: boolean; coldChainCertified?: boolean } = {}): Courier {
  let courier = Courier.create({ id: COURIER_ID, userId: USER_ID, chainId: overrides.chainId ?? null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
  courier = courier.goOnShift()
  if (overrides.coldChainCertified === true) {
    courier = Courier.restore({ ...courier.props, coldChainCertified: true })
  }
  if (overrides.hasLocation !== false) {
    const point = GeoPoint.create(COURIER_LAT, COURIER_LON)
    if (!point.ok) throw new Error('fixture error')
    courier = courier.updateLocation({ point: point.value, capturedAt: NOW })
  }
  return courier
}

function makePharmacy(id: string, lat: number, chainId: string | null = null): PharmacyLocation {
  const geo = GeoPoint.create(lat, COURIER_LON)
  if (!geo.ok) throw new Error('fixture error')
  return { id, name: `Pharmacy-${id}`, addressText: 'Address', geoPoint: geo.value, chainId }
}

function makeOrderContext(orderId: string, pharmacyId: string): DeliveryOrderContext {
  return {
    orderId,
    tenantId: 'tenant-1',
    pharmacyId,
    customerId: 'customer-1',
    medicineIds: [],
    itemsCount: 1,
    paymentMethod: 'cash_courier',
    deliveryGeoPoint: null,
    deliveryFeeDiram: 1000n,
    totalAmountDiram: 1000n,
    deliveryAddress: 'Addr',
    deliveryLandmark: null,
    handoverOtpId: null,
  }
}

interface SetupInput {
  readonly courier?: Courier | null
  readonly pool?: readonly DeliveryAssignment[]
  readonly orderContexts?: Record<string, DeliveryOrderContext>
  readonly pharmacies?: Record<string, PharmacyLocation | null>
}

function makeUseCase(input: SetupInput = {}): GetAvailableDeliveryPoolUseCase {
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByUserId: vi.fn().mockResolvedValue(input.courier === undefined ? makeCourier() : input.courier),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByCourierAndStatuses: vi.fn().mockResolvedValue([]),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    save: vi.fn().mockResolvedValue(undefined),
    claimUnassigned: vi.fn().mockResolvedValue(true),
    assignManual: vi.fn().mockResolvedValue(true),
    findUnassignedPool: vi.fn().mockResolvedValue(input.pool ?? []),
    findByStatuses: vi.fn().mockResolvedValue([]),
  }
  const orderContexts = input.orderContexts ?? {}
  const pharmacies = input.pharmacies ?? {}
  const orders: DeliveryOrdersPort = {
    getOrderForRating: vi.fn().mockResolvedValue(null),
    getDeliveryContext: vi.fn().mockImplementation((orderId: string) => Promise.resolve(orderContexts[orderId] ?? null)),
    markOrderDelivered: vi.fn(),
    verifyHandoverOtp: vi.fn(),
    reissueHandoverOtp: vi.fn(),
  }
  const pharmacyLookup: PharmacyLookupPort = {
    findById: vi.fn().mockImplementation((pharmacyId: string) => Promise.resolve(pharmacies[pharmacyId] ?? null)),
    findByIds: vi.fn().mockResolvedValue([]),
  }
  return new GetAvailableDeliveryPoolUseCase(couriers, assignments, orders, pharmacyLookup)
}

describe('GetAvailableDeliveryPoolUseCase', () => {
  it('SRS-DELIV-015: возвращает пул, отсортированный по расстоянию asc, дальняя аптека вне radiusKm отсеяна', async () => {
    const near = makeAssignment('near')
    const far = makeAssignment('far')
    const useCase = makeUseCase({
      pool: [far, near],
      orderContexts: { 'order-near': makeOrderContext('order-near', 'pharmacy-near'), 'order-far': makeOrderContext('order-far', 'pharmacy-far') },
      pharmacies: { 'pharmacy-near': makePharmacy('pharmacy-near', NEAR_LAT), 'pharmacy-far': makePharmacy('pharmacy-far', FAR_LAT) },
    })

    const result = await useCase.execute({ userId: USER_ID, radiusKm: 5 })

    expect(result).toHaveLength(1)
    expect(result[0]?.deliveryAssignmentId).toBe('near')
  })

  it('курьер не на смене -> CourierNotOnShiftError', async () => {
    const useCase = makeUseCase({ courier: (() => { const c = Courier.create({ id: COURIER_ID, userId: USER_ID, chainId: null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW }); return c })() })

    await expect(useCase.execute({ userId: USER_ID, radiusKm: 5 })).rejects.toBeInstanceOf(CourierNotOnShiftError)
  })

  it('курьер без свежей геопозиции -> пустой список (не ошибка)', async () => {
    const useCase = makeUseCase({ courier: makeCourier({ hasLocation: false }) })

    await expect(useCase.execute({ userId: USER_ID, radiusKm: 5 })).resolves.toEqual([])
  })

  it('SRS-DOM-037: аптека другой сети (own_fleet курьер) -> назначение отфильтровано', async () => {
    const assignment = makeAssignment('own-fleet-mismatch')
    const useCase = makeUseCase({
      courier: makeCourier({ chainId: 'chain-A' }),
      pool: [assignment],
      orderContexts: { 'order-own-fleet-mismatch': makeOrderContext('order-own-fleet-mismatch', 'pharmacy-x') },
      pharmacies: { 'pharmacy-x': makePharmacy('pharmacy-x', NEAR_LAT, 'chain-B') },
    })

    await expect(useCase.execute({ userId: USER_ID, radiusKm: 5 })).resolves.toEqual([])
  })

  it('SRS-DOM-038: cold-chain требуется, курьер не сертифицирован -> назначение отфильтровано', async () => {
    const assignment = makeAssignment('cold-chain-required', true)
    const useCase = makeUseCase({
      pool: [assignment],
      orderContexts: { 'order-cold-chain-required': makeOrderContext('order-cold-chain-required', 'pharmacy-y') },
      pharmacies: { 'pharmacy-y': makePharmacy('pharmacy-y', NEAR_LAT) },
    })

    await expect(useCase.execute({ userId: USER_ID, radiusKm: 5 })).resolves.toEqual([])
  })

  it('актор не найден как курьер -> NotFoundError', async () => {
    const useCase = makeUseCase({ courier: null })

    await expect(useCase.execute({ userId: USER_ID, radiusKm: 5 })).rejects.toBeInstanceOf(NotFoundError)
  })
})
