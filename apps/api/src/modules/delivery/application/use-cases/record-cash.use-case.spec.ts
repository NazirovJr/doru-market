import { describe, expect, it, vi } from 'vitest'
import { BusinessRuleViolationError, CashAmountMismatchError, ForbiddenError, NoActiveShiftError, NotFoundError } from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { Courier } from '../../domain/courier.entity.js'
import { CourierShift } from '../../domain/courier-shift.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { CourierShiftRepositoryPort } from '../ports/courier-shift.repository.port.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { RecordCashUseCase } from './record-cash.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const COURIER_ID = 'courier-1'
const USER_ID = 'user-1'

function makeAssignment(): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    courierId: COURIER_ID,
    status: 'en_route_to_customer',
    landmarkText: null,
    handoverOtpId: 'otp-1',
    cashCollectedDiram: null,
    cashChangeDiram: null,
    reassignReason: null,
    reassignedBy: null,
    assignedAt: NOW,
    pickedUpFromPharmacyAt: NOW,
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

function makeOnShiftCourier(): Courier {
  return Courier.restore({ ...makeOffShiftCourier().props, shiftStatus: 'on_shift' })
}

function makeOffShiftCourier(): Courier {
  return Courier.create({ id: COURIER_ID, userId: USER_ID, chainId: null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
}

function makeActiveShift(): CourierShift {
  return CourierShift.start({ id: 'shift-1', courierId: COURIER_ID, openingCashOnHandDiram: Money.fromDiram(0n), hasActiveShift: false, now: NOW })
}

function makeOrderContext(paymentMethod = 'cash_courier'): DeliveryOrderContext {
  return {
    orderId: ORDER_ID,
    tenantId: 'tenant-1',
    pharmacyId: 'pharmacy-1',
    customerId: 'customer-1',
    medicineIds: [],
    itemsCount: 1,
    paymentMethod,
    deliveryGeoPoint: null,
    deliveryFeeDiram: 500n,
    totalAmountDiram: 6000n,
    deliveryAddress: 'Addr',
    deliveryLandmark: null,
    handoverOtpId: 'otp-1',
  }
}

interface Harness {
  readonly useCase: RecordCashUseCase
  readonly assignmentsSave: ReturnType<typeof vi.fn>
  readonly shiftsSave: ReturnType<typeof vi.fn>
  readonly couriersSave: ReturnType<typeof vi.fn>
}

function makeUseCase(params: {
  assignment?: DeliveryAssignment | null
  courier?: Courier | null
  activeShift?: CourierShift | null
  orderContext?: DeliveryOrderContext
}): Harness {
  const assignmentsSave = vi.fn().mockResolvedValue(undefined)
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.assignment === undefined ? makeAssignment() : params.assignment),
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
  const couriersSave = vi.fn().mockResolvedValue(undefined)
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByUserId: vi.fn().mockResolvedValue(params.courier === undefined ? makeOnShiftCourier() : params.courier),
    save: couriersSave,
  }
  const shiftsSave = vi.fn().mockResolvedValue(undefined)
  const shifts: CourierShiftRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findActiveByCourierId: vi.fn().mockResolvedValue(params.activeShift === undefined ? makeActiveShift() : params.activeShift),
    save: shiftsSave,
  }
  const orders: DeliveryOrdersPort = {
    getOrderForRating: vi.fn().mockResolvedValue(null),
    getDeliveryContext: vi.fn().mockResolvedValue(params.orderContext ?? makeOrderContext()),
    markOrderDelivered: vi.fn(),
  }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  return { useCase: new RecordCashUseCase(couriers, assignments, shifts, orders, uow), assignmentsSave, shiftsSave, couriersSave }
}

describe('RecordCashUseCase', () => {
  it('TC-DELIV-010: collected=6000, change=0, total=6000 -> 200, courier.currentCashOnHandDiram += 6000, shift.cashCollectedDiram += 6000', async () => {
    const { useCase, couriersSave, shiftsSave } = makeUseCase({})

    const result = await useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, collectedDiram: 6000, changeDiram: 0 })

    expect(result).toEqual({ deliveryAssignmentId: ASSIGNMENT_ID, cashCollectedDiram: 6000, cashChangeDiram: 0 })
    const savedCourier = couriersSave.mock.calls[0]?.[0] as Courier
    expect(savedCourier.currentCashOnHandDiram.diram).toBe(6000n)
    const savedShift = shiftsSave.mock.calls[0]?.[0] as CourierShift
    expect(savedShift.toSnapshot().cashCollectedDiram.diram).toBe(6000n)
  })

  it('TC-DELIV-011: collected=6000, change=500 при total=6000 -> 422 CashAmountMismatchError', async () => {
    const { useCase } = makeUseCase({})

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, collectedDiram: 6000, changeDiram: 500 }),
    ).rejects.toBeInstanceOf(CashAmountMismatchError)
  })

  it('payment_method != cash_courier -> BusinessRuleViolationError', async () => {
    const { useCase } = makeUseCase({ orderContext: makeOrderContext('card_online') })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, collectedDiram: 6000, changeDiram: 0 }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError)
  })

  it('курьер не на смене (off_shift) -> NoActiveShiftError', async () => {
    const { useCase } = makeUseCase({ courier: makeOffShiftCourier() })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, collectedDiram: 6000, changeDiram: 0 }),
    ).rejects.toBeInstanceOf(NoActiveShiftError)
  })

  it('назначение принадлежит другому курьеру -> ForbiddenError', async () => {
    const otherCourier = Courier.restore({ ...makeOnShiftCourier().props, id: 'courier-2' })
    const { useCase } = makeUseCase({ courier: otherCourier })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, collectedDiram: 6000, changeDiram: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('нет активной смены курьера (данные рассинхронизированы) -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ activeShift: null })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, collectedDiram: 6000, changeDiram: 0 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('назначение не найдено -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ assignment: null })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, collectedDiram: 6000, changeDiram: 0 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
