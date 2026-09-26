import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, ForbiddenTransitionError, NotFoundError, type DeliveryAssignmentStatus } from '@dorutj/contracts'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import type { CourierDepartSlaWatchdogQueuePort } from '../ports/courier-depart-sla-watchdog-queue.port.js'
import { DepartUseCase } from './depart.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const COURIER_ID = 'courier-1'
const USER_ID = 'user-1'
const OTHER_COURIER_ID = 'courier-2'

function makeAssignment(status: DeliveryAssignmentStatus, courierId: string | null = COURIER_ID): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    courierId,
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
  readonly useCase: DepartUseCase
  readonly assignmentsSave: ReturnType<typeof vi.fn>
  readonly watchdogCancel: ReturnType<typeof vi.fn>
}

function makeUseCase(params: { assignment?: DeliveryAssignment | null; courier?: Courier | null }): Harness {
  const assignmentsSave = vi.fn().mockResolvedValue(undefined)
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.assignment === undefined ? makeAssignment('assigned') : params.assignment),
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
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByUserId: vi.fn().mockResolvedValue(params.courier === undefined ? makeCourier() : params.courier),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const watchdogCancel = vi.fn().mockResolvedValue(undefined)
  const watchdog: CourierDepartSlaWatchdogQueuePort = { schedule: vi.fn().mockResolvedValue(undefined), cancel: watchdogCancel }
  return { useCase: new DepartUseCase(couriers, assignments, uow, watchdog), assignmentsSave, watchdogCancel }
}

describe('DepartUseCase', () => {
  it('assigned -> en_route_to_pharmacy, watchdog SLA-выезда отменяется', async () => {
    const { useCase, assignmentsSave, watchdogCancel } = makeUseCase({})

    const result = await useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })

    expect(result.deliveryAssignmentId).toBe(ASSIGNMENT_ID)
    const saved = assignmentsSave.mock.calls[0]?.[0] as DeliveryAssignment
    expect(saved.status).toBe('en_route_to_pharmacy')
    expect(watchdogCancel).toHaveBeenCalledWith(ASSIGNMENT_ID)
  })

  it('назначение принадлежит другому курьеру -> ForbiddenError, watchdog НЕ отменяется', async () => {
    const { useCase, watchdogCancel } = makeUseCase({ assignment: makeAssignment('assigned', OTHER_COURIER_ID) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(ForbiddenError)
    expect(watchdogCancel).not.toHaveBeenCalled()
  })

  it('назначение не найдено -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ assignment: null })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('актор не найден как курьер -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ courier: null })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('статус не assigned (напр. уже en_route_to_pharmacy) -> ForbiddenTransitionError', async () => {
    const { useCase } = makeUseCase({ assignment: makeAssignment('en_route_to_pharmacy') })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID })).rejects.toBeInstanceOf(ForbiddenTransitionError)
  })
})
