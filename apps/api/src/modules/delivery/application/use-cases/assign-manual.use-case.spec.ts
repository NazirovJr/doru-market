import { describe, expect, it, vi } from 'vitest'
import { AssignmentAlreadyClaimedError, ForbiddenError, NotFoundError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/index.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import { DeliveryOffer } from '../../domain/delivery-offer.entity.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { PharmacyLookupPort, PharmacyLocation } from '../ports/pharmacy-lookup.port.js'
import type { DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import type { CourierDepartSlaWatchdogQueuePort } from '../ports/courier-depart-sla-watchdog-queue.port.js'
import { AssignManualUseCase } from './assign-manual.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const COURIER_ID = 'courier-1'
const PHARMACY_ID = 'pharmacy-1'

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

function makeCourier(chainId: string | null = null): Courier {
  return Courier.create({ id: COURIER_ID, userId: 'courier-user-1', chainId, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
}

function makePendingOffer(): DeliveryOffer {
  return DeliveryOffer.create({
    id: 'offer-1',
    deliveryAssignmentId: ASSIGNMENT_ID,
    courierId: 'other-courier',
    sequenceNo: 1,
    distanceMeters: 500,
    score: 0.5,
    offeredAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
  })
}

interface Harness {
  readonly useCase: AssignManualUseCase
  readonly assignManualCall: ReturnType<typeof vi.fn>
  readonly offersSave: ReturnType<typeof vi.fn>
  readonly outboxAppend: ReturnType<typeof vi.fn>
}

function makeUseCase(
  params: { courier?: Courier | null; assignResult?: boolean; pendingOffers?: readonly DeliveryOffer[]; pharmacyChainId?: string | null } = {},
): Harness {
  const assignManualCall = vi.fn().mockResolvedValue(params.assignResult ?? true)
  const offersSave = vi.fn().mockResolvedValue(undefined)
  const outboxAppend = vi.fn().mockResolvedValue(undefined)
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(makeAssignment()),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    save: vi.fn().mockResolvedValue(undefined),
    claimUnassigned: vi.fn().mockResolvedValue(true),
    assignManual: assignManualCall,
    findUnassignedPool: vi.fn().mockResolvedValue([]),
    findByStatuses: vi.fn().mockResolvedValue([]),
  }
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.courier === undefined ? makeCourier() : params.courier),
    findByUserId: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const offers: DeliveryOfferRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByIdForUpdate: vi.fn().mockResolvedValue(null),
    findPendingByCourierId: vi.fn().mockResolvedValue([]),
    findByAssignmentId: vi.fn().mockResolvedValue(params.pendingOffers ?? []),
    save: offersSave,
  }
  const geo = GeoPoint.create(38.5598, 68.787)
  if (!geo.ok) throw new Error('fixture error')
  const pharmacyLocation: PharmacyLocation = {
    id: PHARMACY_ID,
    name: 'Pharmacy',
    addressText: 'Address',
    geoPoint: geo.value,
    chainId: params.pharmacyChainId === undefined ? null : params.pharmacyChainId,
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
  const orders: DeliveryOrdersPort = { getOrderForRating: vi.fn().mockResolvedValue(null), getDeliveryContext: vi.fn().mockResolvedValue(orderContext) }
  const pharmacies: PharmacyLookupPort = { findById: vi.fn().mockResolvedValue(pharmacyLocation) }
  const outbox: DeliveryOutboxPort = { append: outboxAppend }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const watchdog: CourierDepartSlaWatchdogQueuePort = { schedule: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined) }
  const clock: Clock = { now: () => NOW }
  return {
    useCase: new AssignManualUseCase(assignments, couriers, offers, orders, pharmacies, outbox, uow, watchdog, clock),
    assignManualCall,
    offersSave,
    outboxAppend,
  }
}

describe('AssignManualUseCase', () => {
  it('SRS-DELIV-033: super_admin назначает курьера пула (chainId=null) -> 200, назначение assigned', async () => {
    const { useCase, assignManualCall, outboxAppend } = makeUseCase()

    const result = await useCase.execute({
      assignmentId: ASSIGNMENT_ID,
      courierId: COURIER_ID,
      actor: { userId: 'admin-1', role: 'super_admin', chainId: null },
    })

    expect(result.deliveryAssignmentId).toBe(ASSIGNMENT_ID)
    expect(assignManualCall).toHaveBeenCalledWith({ id: ASSIGNMENT_ID, courierId: COURIER_ID, now: NOW }, undefined)
    expect(outboxAppend).toHaveBeenCalled()
  })

  it('позитивный override-тест: активные pending-офферы переходят в superseded', async () => {
    const { useCase, offersSave } = makeUseCase({ pendingOffers: [makePendingOffer()] })

    await useCase.execute({ assignmentId: ASSIGNMENT_ID, courierId: COURIER_ID, actor: { userId: 'admin-1', role: 'super_admin', chainId: null } })

    const savedOffer = offersSave.mock.calls[0]?.[0] as DeliveryOffer
    expect(savedOffer.status).toBe('superseded')
  })

  it('«Риски» тикета: pharmacy_admin и курьер платформенного пула (chainId=null) -> ForbiddenError', async () => {
    const { useCase, assignManualCall } = makeUseCase({ courier: makeCourier(null) })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, courierId: COURIER_ID, actor: { userId: 'pa-1', role: 'pharmacy_admin', chainId: 'chain-A' } }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(assignManualCall).not.toHaveBeenCalled()
  })

  it('pharmacy_admin, курьер чужой сети -> ForbiddenError', async () => {
    const { useCase } = makeUseCase({ courier: makeCourier('chain-B') })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, courierId: COURIER_ID, actor: { userId: 'pa-1', role: 'pharmacy_admin', chainId: 'chain-A' } }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pharmacy_admin, свой флот (chainId совпадает) -> 200', async () => {
    const { useCase } = makeUseCase({ courier: makeCourier('chain-A'), pharmacyChainId: 'chain-A' })

    const result = await useCase.execute({
      assignmentId: ASSIGNMENT_ID,
      courierId: COURIER_ID,
      actor: { userId: 'pa-1', role: 'pharmacy_admin', chainId: 'chain-A' },
    })

    expect(result.deliveryAssignmentId).toBe(ASSIGNMENT_ID)
  })

  it('назначение уже занято (гонка с claim) -> AssignmentAlreadyClaimedError', async () => {
    const { useCase } = makeUseCase({ assignResult: false })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, courierId: COURIER_ID, actor: { userId: 'admin-1', role: 'super_admin', chainId: null } }),
    ).rejects.toBeInstanceOf(AssignmentAlreadyClaimedError)
  })

  it('курьер не найден -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ courier: null })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, courierId: COURIER_ID, actor: { userId: 'admin-1', role: 'super_admin', chainId: null } }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
