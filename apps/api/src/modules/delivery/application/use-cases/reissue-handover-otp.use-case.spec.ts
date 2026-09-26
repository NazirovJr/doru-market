import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, type DeliveryAssignmentStatus } from '@dorutj/contracts'
import type { OtpGeneratorPort } from '@/modules/auth/index.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { ReissueHandoverOtpUseCase } from './reissue-handover-otp.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const OLD_OTP_ID = 'otp-old'
const NEW_OTP_ID = 'otp-new'

function makeAssignment(status: DeliveryAssignmentStatus = 'en_route_to_customer', handoverOtpId: string | null = OLD_OTP_ID): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    courierId: 'courier-1',
    status,
    landmarkText: null,
    handoverOtpId,
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

function makeOrderContext(): DeliveryOrderContext {
  return {
    orderId: ORDER_ID,
    tenantId: 'tenant-1',
    pharmacyId: 'pharmacy-1',
    customerId: 'customer-1',
    medicineIds: [],
    itemsCount: 1,
    paymentMethod: 'cash_courier',
    deliveryGeoPoint: null,
    deliveryFeeDiram: 500n,
    totalAmountDiram: 6000n,
    deliveryAddress: 'Addr',
    deliveryLandmark: null,
    handoverOtpId: OLD_OTP_ID,
  }
}

interface Harness {
  readonly useCase: ReissueHandoverOtpUseCase
  readonly assignmentsSave: ReturnType<typeof vi.fn>
  readonly otpCreate: ReturnType<typeof vi.fn>
}

function makeUseCase(params: { assignment?: DeliveryAssignment | null; orderContext?: DeliveryOrderContext | null }): Harness {
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
  const orders: DeliveryOrdersPort = {
    getOrderForRating: vi.fn().mockResolvedValue(null),
    getDeliveryContext: vi.fn().mockResolvedValue(params.orderContext === undefined ? makeOrderContext() : params.orderContext),
    markOrderDelivered: vi.fn(),
  }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const otpGenerator: OtpGeneratorPort = { generate: vi.fn().mockReturnValue({ code: '4321', codeHash: 'unused' }) }
  const otpCreate = vi.fn().mockResolvedValue(undefined)
  const otpCodesRepository = {
    create: otpCreate,
    findById: vi.fn(),
    findByIdForUpdate: vi.fn(),
    markConsumed: vi.fn(),
    incrementAttempts: vi.fn(),
    findActiveBySubject: vi.fn(),
    countBySubjectAndPurpose: vi.fn(),
  }
  const clock = { now: () => NOW }
  const ids = { next: () => NEW_OTP_ID }
  return {
    useCase: new ReissueHandoverOtpUseCase(assignments, orders, uow, otpGenerator, otpCodesRepository, clock, ids),
    assignmentsSave,
    otpCreate,
  }
}

describe('ReissueHandoverOtpUseCase', () => {
  it('назначение нетерминально + handoverOtpId уже есть -> новый OTP выпущен, закреплён на назначении, код возвращён', async () => {
    const { useCase, assignmentsSave, otpCreate } = makeUseCase({})

    const result = await useCase.execute({ assignmentId: ASSIGNMENT_ID })

    expect(result).toEqual({ deliveryAssignmentId: ASSIGNMENT_ID, code: '4321', expiresAt: expect.any(Date) as Date })
    expect(otpCreate).toHaveBeenCalledWith(expect.objectContaining({ id: NEW_OTP_ID, purpose: 'delivery_handover', subjectRef: ORDER_ID }) as unknown)
    const saved = assignmentsSave.mock.calls[0]?.[0] as DeliveryAssignment
    expect(saved.handoverOtpId).toBe(NEW_OTP_ID)
  })

  it('назначение терминально (delivered) -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ assignment: makeAssignment('delivered') })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('handoverOtpId ещё не закреплён (департ к клиенту ещё не было) -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ assignment: makeAssignment('en_route_to_customer', null) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('назначение не найдено -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ assignment: null })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('заказ не найден -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ orderContext: null })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID })).rejects.toBeInstanceOf(NotFoundError)
  })
})
