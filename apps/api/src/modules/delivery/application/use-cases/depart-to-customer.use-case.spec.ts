import { describe, expect, it, vi } from 'vitest'
import {
  ColdChainBagNotConfirmedError,
  ForbiddenError,
  ForbiddenTransitionError,
  HandoverOtpNotFoundError,
  NotFoundError,
  type DeliveryAssignmentStatus,
} from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/index.js'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { DepartToCustomerUseCase } from './depart-to-customer.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const COURIER_ID = 'courier-1'
const USER_ID = 'user-1'
const OTP_ID = 'otp-1'

function makeAssignment(status: DeliveryAssignmentStatus, requiresColdChain = false): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    courierId: COURIER_ID,
    status,
    landmarkText: null,
    handoverOtpId: null,
    cashCollectedDiram: null,
    cashChangeDiram: null,
    reassignReason: null,
    reassignedBy: null,
    assignedAt: NOW,
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

function makeOrderContext(overrides: Partial<DeliveryOrderContext> = {}): DeliveryOrderContext {
  return {
    orderId: ORDER_ID,
    tenantId: 'tenant-1',
    pharmacyId: 'pharmacy-1',
    customerId: 'customer-1',
    medicineIds: [],
    itemsCount: 1,
    paymentMethod: 'cash_courier',
    deliveryGeoPoint: null,
    deliveryFeeDiram: 1000n,
    totalAmountDiram: 1000n,
    deliveryAddress: 'Addr',
    deliveryLandmark: null,
    handoverOtpId: OTP_ID,
    ...overrides,
  }
}

interface Harness {
  readonly useCase: DepartToCustomerUseCase
  readonly assignmentsSave: ReturnType<typeof vi.fn>
}

function makeUseCase(params: {
  assignment?: DeliveryAssignment | null
  courier?: Courier | null
  orderContext?: DeliveryOrderContext | null
}): Harness {
  const assignmentsSave = vi.fn().mockResolvedValue(undefined)
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.assignment === undefined ? makeAssignment('en_route_to_pharmacy') : params.assignment),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByCourierAndStatuses: vi.fn().mockResolvedValue([]),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    claimUnassigned: vi.fn().mockResolvedValue(true),
    assignManual: vi.fn().mockResolvedValue(true),
    findUnassignedPool: vi.fn().mockResolvedValue([]),
    findByStatuses: vi.fn().mockResolvedValue([]),
    save: assignmentsSave,
  }
  const courier = Courier.create({ id: COURIER_ID, userId: USER_ID, chainId: null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByUserId: vi.fn().mockResolvedValue(params.courier === undefined ? courier : params.courier),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const orders: DeliveryOrdersPort = {
    getOrderForRating: vi.fn().mockResolvedValue(null),
    getDeliveryContext: vi.fn().mockResolvedValue(params.orderContext === undefined ? makeOrderContext() : params.orderContext),
    markOrderDelivered: vi.fn(),
    verifyHandoverOtp: vi.fn(),
    reissueHandoverOtp: vi.fn(),
  }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const clock: Clock = { now: () => NOW }
  return { useCase: new DepartToCustomerUseCase(couriers, assignments, orders, uow, clock), assignmentsSave }
}

describe('DepartToCustomerUseCase', () => {
  it('en_route_to_pharmacy -> en_route_to_customer (через picked_up_from_pharmacy), handoverOtpId закрепляется', async () => {
    const { useCase, assignmentsSave } = makeUseCase({})

    const result = await useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })

    expect(result.deliveryAssignmentId).toBe(ASSIGNMENT_ID)
    const saved = assignmentsSave.mock.calls[0]?.[0] as DeliveryAssignment
    expect(saved.status).toBe('en_route_to_customer')
    expect(saved.handoverOtpId).toBe(OTP_ID)
  })

  it('requiresColdChain=true, coldChainBagConfirmed отсутствует -> 422 ColdChainBagNotConfirmedError', async () => {
    const { useCase } = makeUseCase({ assignment: makeAssignment('en_route_to_pharmacy', true) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(ColdChainBagNotConfirmedError)
  })

  it('requiresColdChain=true, coldChainBagConfirmed=true -> успех', async () => {
    const { useCase, assignmentsSave } = makeUseCase({ assignment: makeAssignment('en_route_to_pharmacy', true) })

    await useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, coldChainBagConfirmed: true })

    const saved = assignmentsSave.mock.calls[0]?.[0] as DeliveryAssignment
    expect(saved.status).toBe('en_route_to_customer')
  })

  it('назначение принадлежит другому курьеру -> ForbiddenError', async () => {
    const otherCourier = Courier.create({ id: 'courier-2', userId: USER_ID, chainId: null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
    const { useCase } = makeUseCase({ courier: otherCourier })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('заказ без выданного OTP вручения -> HandoverOtpNotFoundError (инвариант нарушен)', async () => {
    const { useCase } = makeUseCase({ orderContext: makeOrderContext({ handoverOtpId: null }) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(HandoverOtpNotFoundError)
  })

  it('статус не en_route_to_pharmacy -> ForbiddenTransitionError', async () => {
    const { useCase } = makeUseCase({ assignment: makeAssignment('assigned') })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(ForbiddenTransitionError)
  })

  it('назначение не найдено -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ assignment: null })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(NotFoundError)
  })
})
