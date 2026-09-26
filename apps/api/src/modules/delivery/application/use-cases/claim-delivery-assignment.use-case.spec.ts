import { describe, expect, it, vi } from 'vitest'
import { AssignmentAlreadyClaimedError, CourierNotEligibleError, CourierNotOnShiftError, CourierTenantMismatchError, NotFoundError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/index.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { PharmacyLookupPort, PharmacyLocation } from '../ports/pharmacy-lookup.port.js'
import type { DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import type { CourierDepartSlaWatchdogQueuePort } from '../ports/courier-depart-sla-watchdog-queue.port.js'
import { ClaimDeliveryAssignmentUseCase } from './claim-delivery-assignment.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const COURIER_ID = 'courier-1'
const USER_ID = 'user-1'
const PHARMACY_ID = 'pharmacy-1'

function makeAssignment(overrides: { status?: DeliveryAssignmentSnapshot['status']; requiresColdChain?: boolean } = {}): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    courierId: null,
    status: overrides.status ?? 'unassigned',
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
    requiresColdChain: overrides.requiresColdChain ?? false,
    coldChainBagConfirmed: null,
    coldChainBagConfirmedAt: null,
    contactAttemptsCount: 0,
    lastContactAttemptAt: null,
    distanceMeters: null,
  }
  return DeliveryAssignment.restore(snapshot)
}

function makeCourier(
  overrides: { chainId?: string | null; shiftStatus?: 'on_shift' | 'off_shift'; coldChainCertified?: boolean; status?: Courier['status'] } = {},
): Courier {
  let courier = Courier.create({ id: COURIER_ID, userId: USER_ID, chainId: overrides.chainId ?? null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
  if ((overrides.shiftStatus ?? 'on_shift') === 'on_shift') {
    courier = courier.goOnShift()
  }
  courier = Courier.restore({ ...courier.props, coldChainCertified: overrides.coldChainCertified === true, status: overrides.status ?? 'active' })
  return courier
}

interface Harness {
  readonly useCase: ClaimDeliveryAssignmentUseCase
  readonly claimUnassigned: ReturnType<typeof vi.fn>
  readonly outboxAppend: ReturnType<typeof vi.fn>
  readonly watchdogSchedule: ReturnType<typeof vi.fn>
}

function makeUseCase(params: {
  courier?: Courier | null
  assignment?: DeliveryAssignment | null
  claimResult?: boolean
  pharmacyChainId?: string | null
} = {}): Harness {
  const claimUnassigned = vi.fn().mockResolvedValue(params.claimResult ?? true)
  const outboxAppend = vi.fn().mockResolvedValue(undefined)
  const watchdogSchedule = vi.fn().mockResolvedValue(undefined)
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByUserId: vi.fn().mockResolvedValue(params.courier === undefined ? makeCourier() : params.courier),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.assignment === undefined ? makeAssignment() : params.assignment),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByCourierAndStatuses: vi.fn().mockResolvedValue([]),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    save: vi.fn().mockResolvedValue(undefined),
    claimUnassigned,
    assignManual: vi.fn().mockResolvedValue(true),
    findUnassignedPool: vi.fn().mockResolvedValue([]),
    findByStatuses: vi.fn().mockResolvedValue([]),
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
    customerId: 'customer-1',
    itemsCount: 1,
    paymentMethod: 'cash_courier',
    deliveryGeoPoint: null,
    deliveryFeeDiram: 1000n,
    totalAmountDiram: 1000n,
    deliveryAddress: 'Addr',
    deliveryLandmark: null,
    handoverOtpId: null,
  }
  const orders: DeliveryOrdersPort = { getOrderForRating: vi.fn().mockResolvedValue(null), getDeliveryContext: vi.fn().mockResolvedValue(orderContext), markOrderDelivered: vi.fn() }
  const pharmacies: PharmacyLookupPort = { findById: vi.fn().mockResolvedValue(pharmacyLocation), findByIds: vi.fn().mockResolvedValue([]) }
  const outbox: DeliveryOutboxPort = { append: outboxAppend }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const watchdog: CourierDepartSlaWatchdogQueuePort = { schedule: watchdogSchedule, cancel: vi.fn().mockResolvedValue(undefined) }
  const clock: Clock = { now: () => NOW }
  return {
    useCase: new ClaimDeliveryAssignmentUseCase(couriers, assignments, orders, pharmacies, outbox, uow, watchdog, clock),
    claimUnassigned,
    outboxAppend,
    watchdogSchedule,
  }
}

describe('ClaimDeliveryAssignmentUseCase', () => {
  it('TC-DELIV-016: unassigned в пуле, on_shift курьер -> 200, claimUnassigned вызван, CourierAssignedEvent опубликован, watchdog запланирован', async () => {
    const { useCase, claimUnassigned, outboxAppend, watchdogSchedule } = makeUseCase()

    const result = await useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })

    expect(result.deliveryAssignmentId).toBe(ASSIGNMENT_ID)
    expect(claimUnassigned).toHaveBeenCalledWith({ id: ASSIGNMENT_ID, courierId: COURIER_ID, now: NOW }, undefined)
    const [publishedEvent] = outboxAppend.mock.calls[0] as [unknown]
    expect(publishedEvent).toMatchObject({ type: 'CourierAssignedEvent', deliveryAssignmentId: ASSIGNMENT_ID, courierId: COURIER_ID })
    expect(watchdogSchedule).toHaveBeenCalledWith({ deliveryAssignmentId: ASSIGNMENT_ID, delayMinutes: expect.any(Number) as number })
  })

  it('TC-DELIV-006/072: claimUnassigned вернул false (проиграл гонку) -> 409 AssignmentAlreadyClaimedError', async () => {
    const { useCase } = makeUseCase({ claimResult: false })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(AssignmentAlreadyClaimedError)
  })

  it('назначение уже не unassigned (быстрый путь без похода к БД условного UPDATE) -> AssignmentAlreadyClaimedError', async () => {
    const { useCase, claimUnassigned } = makeUseCase({ assignment: makeAssignment({ status: 'assigned' }) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(AssignmentAlreadyClaimedError)
    expect(claimUnassigned).not.toHaveBeenCalled()
  })

  it('курьер не на смене -> CourierNotOnShiftError', async () => {
    const { useCase } = makeUseCase({ courier: makeCourier({ shiftStatus: 'off_shift' }) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(CourierNotOnShiftError)
  })

  it('актор не найден как курьер -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ courier: null })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('SRS-DOM-037: курьер своей сети, аптека другой сети -> CourierTenantMismatchError, claimUnassigned не вызван', async () => {
    const { useCase, claimUnassigned } = makeUseCase({ courier: makeCourier({ chainId: 'chain-A' }), pharmacyChainId: 'chain-B' })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(CourierTenantMismatchError)
    expect(claimUnassigned).not.toHaveBeenCalled()
  })

  it('SRS-DOM-038: cold-chain требуется, курьер не сертифицирован -> CourierNotEligibleError до похода к БД', async () => {
    const { useCase, claimUnassigned } = makeUseCase({ assignment: makeAssignment({ requiresColdChain: true }) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toThrow()
    expect(claimUnassigned).not.toHaveBeenCalled()
  })

  it.each(['pending_verification', 'suspended'] as const)('courier.status=%s -> CourierNotEligibleError, claimUnassigned не вызван', async (status) => {
    const { useCase, claimUnassigned } = makeUseCase({ courier: makeCourier({ status }) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(CourierNotEligibleError)
    expect(claimUnassigned).not.toHaveBeenCalled()
  })
})
