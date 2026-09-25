import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError, OfferAlreadyRespondedError, OfferExpiredError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/index.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import { DeliveryOffer } from '../../domain/delivery-offer.entity.js'
import type { DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { PharmacyLookupPort, PharmacyLocation } from '../ports/pharmacy-lookup.port.js'
import type { DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import type { DeliveryOfferTimeoutQueuePort } from '../ports/delivery-offer-timeout-queue.port.js'
import { AcceptDeliveryOfferUseCase } from './accept-delivery-offer.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const OFFER_ID = 'offer-1'
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const COURIER_ID = 'courier-1'
const USER_ID = 'user-1'
const PHARMACY_ID = 'pharmacy-1'

function makeOffer(overrides: { status?: 'pending' | 'accepted'; expiresAt?: Date; courierId?: string } = {}): DeliveryOffer {
  const offer = DeliveryOffer.create({
    id: OFFER_ID,
    deliveryAssignmentId: ASSIGNMENT_ID,
    courierId: overrides.courierId ?? COURIER_ID,
    sequenceNo: 1,
    distanceMeters: 500,
    score: 0.8,
    offeredAt: NOW,
    expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + 45_000),
  })
  if (overrides.status === 'accepted') {
    offer.accept(NOW)
  }
  return offer
}

function makeAssignment(): DeliveryAssignment {
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
    requiresColdChain: false,
    coldChainBagConfirmed: null,
    coldChainBagConfirmedAt: null,
    contactAttemptsCount: 0,
    lastContactAttemptAt: null,
    distanceMeters: null,
  }
  return DeliveryAssignment.restore(snapshot)
}

function makeCourier(): Courier {
  return Courier.create({ id: COURIER_ID, userId: USER_ID, chainId: null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
}

interface Harness {
  readonly useCase: AcceptDeliveryOfferUseCase
  readonly offersSave: ReturnType<typeof vi.fn>
  readonly assignmentsSave: ReturnType<typeof vi.fn>
  readonly outboxAppend: ReturnType<typeof vi.fn>
  readonly timeoutCancel: ReturnType<typeof vi.fn>
}

function makeUseCase(params: { offer?: DeliveryOffer | null; courier?: Courier | null }): Harness {
  const offersSave = vi.fn().mockResolvedValue(undefined)
  const assignmentsSave = vi.fn().mockResolvedValue(undefined)
  const outboxAppend = vi.fn().mockResolvedValue(undefined)
  const timeoutCancel = vi.fn().mockResolvedValue(undefined)
  const offers: DeliveryOfferRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByIdForUpdate: vi.fn().mockResolvedValue(params.offer === undefined ? makeOffer() : params.offer),
    findPendingByCourierId: vi.fn().mockResolvedValue([]),
    findByAssignmentId: vi.fn().mockResolvedValue([]),
    save: offersSave,
  }
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(makeAssignment()),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    save: assignmentsSave,
  }
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByUserId: vi.fn().mockResolvedValue(params.courier === undefined ? makeCourier() : params.courier),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const orderContext: DeliveryOrderContext = {
    orderId: ORDER_ID,
    tenantId: 'tenant-1',
    pharmacyId: PHARMACY_ID,
    medicineIds: [],
    itemsCount: 1,
    paymentMethod: 'cash_courier',
    deliveryGeoPoint: null,
    deliveryFeeDiram: 1000n,
  }
  const orders: DeliveryOrdersPort = {
    getOrderForRating: vi.fn().mockResolvedValue(null),
    getDeliveryContext: vi.fn().mockResolvedValue(orderContext),
  }
  const geoPoint = GeoPoint.create(38.5598, 68.787)
  if (!geoPoint.ok) throw new Error('fixture error')
  const pharmacyLocation: PharmacyLocation = { id: PHARMACY_ID, name: 'Pharmacy', addressText: 'Address', geoPoint: geoPoint.value, chainId: null }
  const pharmacies: PharmacyLookupPort = { findById: vi.fn().mockResolvedValue(pharmacyLocation) }
  const outbox: DeliveryOutboxPort = { append: outboxAppend }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const timeoutQueue: DeliveryOfferTimeoutQueuePort = { schedule: vi.fn().mockResolvedValue(undefined), cancel: timeoutCancel }
  const clock: Clock = { now: () => NOW }
  return {
    useCase: new AcceptDeliveryOfferUseCase(offers, assignments, couriers, orders, pharmacies, outbox, uow, timeoutQueue, clock),
    offersSave,
    assignmentsSave,
    outboxAppend,
    timeoutCancel,
  }
}

describe('AcceptDeliveryOfferUseCase', () => {
  it('TC-DELIV-001: pending + не истёк + актор = адресат -> 200, assignment.status=assigned, CourierAssignedEvent опубликовано, таймаут отменён', async () => {
    const { useCase, assignmentsSave, outboxAppend, timeoutCancel } = makeUseCase({})

    const result = await useCase.execute({ offerId: OFFER_ID, userId: USER_ID })

    expect(result.deliveryAssignmentId).toBe(ASSIGNMENT_ID)
    const savedAssignment = assignmentsSave.mock.calls[0]?.[0] as DeliveryAssignment
    expect(savedAssignment.status).toBe('assigned')
    expect(savedAssignment.courierId).toBe(COURIER_ID)
    expect(timeoutCancel).toHaveBeenCalledWith(OFFER_ID)
    const [publishedEvent] = outboxAppend.mock.calls[0] as [unknown]
    expect(publishedEvent).toMatchObject({ type: 'CourierAssignedEvent', deliveryAssignmentId: ASSIGNMENT_ID, courierId: COURIER_ID })
  })

  it('TC-DELIV-002: expires_at в прошлом (гонка) -> OfferExpiredError, assignment не сохраняется', async () => {
    const { useCase, assignmentsSave } = makeUseCase({ offer: makeOffer({ expiresAt: new Date(NOW.getTime() - 1000) }) })

    await expect(useCase.execute({ offerId: OFFER_ID, userId: USER_ID })).rejects.toBeInstanceOf(OfferExpiredError)
    expect(assignmentsSave).not.toHaveBeenCalled()
  })

  it('TC-DELIV-071: status уже НЕ pending (вторая параллельная попытка) -> 409 OfferAlreadyRespondedError', async () => {
    const { useCase } = makeUseCase({ offer: makeOffer({ status: 'accepted' }) })

    await expect(useCase.execute({ offerId: OFFER_ID, userId: USER_ID })).rejects.toBeInstanceOf(OfferAlreadyRespondedError)
  })

  it('оффер адресован другому курьеру -> ForbiddenError', async () => {
    const { useCase } = makeUseCase({ offer: makeOffer({ courierId: 'other-courier' }) })

    await expect(useCase.execute({ offerId: OFFER_ID, userId: USER_ID })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('актор не найден как курьер -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ courier: null })

    await expect(useCase.execute({ offerId: OFFER_ID, userId: USER_ID })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('оффер не найден -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ offer: null })

    await expect(useCase.execute({ offerId: OFFER_ID, userId: USER_ID })).rejects.toBeInstanceOf(NotFoundError)
  })
})
