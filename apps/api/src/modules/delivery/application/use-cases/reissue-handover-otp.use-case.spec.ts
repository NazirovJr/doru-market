import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, type DeliveryAssignmentStatus } from '@dorutj/contracts'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { DeliveryOrdersPort, ReissueHandoverOtpActor } from '../ports/delivery-orders.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { ReissueHandoverOtpUseCase } from './reissue-handover-otp.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const OLD_OTP_ID = 'otp-old'
const NEW_OTP_ID = 'otp-new'

const ACTOR: ReissueHandoverOtpActor = { userId: 'user-1', role: 'support_agent', tenantId: 'tenant-1', pharmacyId: null }

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
    proofPhotoUrl: null,
  }
  return DeliveryAssignment.restore(snapshot)
}

interface Harness {
  readonly useCase: ReissueHandoverOtpUseCase
  readonly assignmentsSave: ReturnType<typeof vi.fn>
  readonly reissueHandoverOtp: ReturnType<typeof vi.fn>
}

function makeUseCase(params: { assignment?: DeliveryAssignment | null; reissueHandoverOtpImpl?: ReturnType<typeof vi.fn> }): Harness {
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
  const reissueHandoverOtp =
    params.reissueHandoverOtpImpl ?? vi.fn().mockResolvedValue({ code: '4321', expiresAt: new Date(NOW.getTime() + 900_000), handoverOtpId: NEW_OTP_ID })
  const orders: DeliveryOrdersPort = {
    getOrderForRating: vi.fn(),
    getDeliveryContext: vi.fn(),
    markOrderDelivered: vi.fn(),
    verifyHandoverOtp: vi.fn(),
    reissueHandoverOtp: reissueHandoverOtp as DeliveryOrdersPort['reissueHandoverOtp'],
  }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  return { useCase: new ReissueHandoverOtpUseCase(assignments, orders, uow), assignmentsSave, reissueHandoverOtp }
}

describe('ReissueHandoverOtpUseCase', () => {
  it('назначение нетерминально + handoverOtpId уже есть -> вызывает orders.reissueHandoverOtp, синхронизирует локальную копию, возвращает код', async () => {
    const { useCase, assignmentsSave, reissueHandoverOtp } = makeUseCase({})

    const result = await useCase.execute({ assignmentId: ASSIGNMENT_ID, actor: ACTOR })

    expect(result).toEqual({ deliveryAssignmentId: ASSIGNMENT_ID, code: '4321', expiresAt: expect.any(Date) as Date })
    expect(reissueHandoverOtp).toHaveBeenCalledWith({ orderId: ORDER_ID, actor: ACTOR })
    const saved = assignmentsSave.mock.calls[0]?.[0] as DeliveryAssignment
    expect(saved.handoverOtpId).toBe(NEW_OTP_ID)
  })

  it('назначение терминально (delivered) -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ assignment: makeAssignment('delivered') })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, actor: ACTOR })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('handoverOtpId ещё не закреплён (департ к клиенту ещё не было) -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ assignment: makeAssignment('en_route_to_customer', null) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, actor: ACTOR })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('назначение не найдено -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ assignment: null })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, actor: ACTOR })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('OrdersFacade.reissueHandoverOtp отклоняет (напр. рейт-лимит) -> ошибка пробрасывается, assignment НЕ сохраняется', async () => {
    const reissueHandoverOtp = vi.fn().mockRejectedValue(new Error('rate limited'))
    const { useCase, assignmentsSave } = makeUseCase({ reissueHandoverOtpImpl: reissueHandoverOtp })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, actor: ACTOR })).rejects.toThrow('rate limited')
    expect(assignmentsSave).not.toHaveBeenCalled()
  })
})
