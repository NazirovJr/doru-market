import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, ForbiddenTransitionError, NotFoundError, ValidationError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/index.js'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import type { CourierDepartSlaWatchdogQueuePort } from '../ports/courier-depart-sla-watchdog-queue.port.js'
import { ReassignDeliveryUseCase } from './reassign-delivery.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const OLD_COURIER_ID = 'courier-old'
const NEW_COURIER_ID = 'courier-new'

function makeAssignment(status: DeliveryAssignmentSnapshot['status'] = 'en_route_to_pharmacy'): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    courierId: OLD_COURIER_ID,
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

function makeCourier(chainId: string | null = null): Courier {
  return Courier.create({ id: NEW_COURIER_ID, userId: 'courier-user-new', chainId, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
}

interface Harness {
  readonly useCase: ReassignDeliveryUseCase
  readonly assignmentsSave: ReturnType<typeof vi.fn>
  readonly outboxAppend: ReturnType<typeof vi.fn>
  readonly watchdogCancel: ReturnType<typeof vi.fn>
  readonly watchdogSchedule: ReturnType<typeof vi.fn>
}

function makeUseCase(params: { courier?: Courier | null; assignment?: DeliveryAssignment | null } = {}): Harness {
  const assignmentsSave = vi.fn().mockResolvedValue(undefined)
  const outboxAppend = vi.fn().mockResolvedValue(undefined)
  const watchdogCancel = vi.fn().mockResolvedValue(undefined)
  const watchdogSchedule = vi.fn().mockResolvedValue(undefined)
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.assignment === undefined ? makeAssignment() : params.assignment),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    save: assignmentsSave,
    claimUnassigned: vi.fn().mockResolvedValue(true),
    assignManual: vi.fn().mockResolvedValue(true),
    findUnassignedPool: vi.fn().mockResolvedValue([]),
    findByStatuses: vi.fn().mockResolvedValue([]),
  }
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.courier === undefined ? makeCourier() : params.courier),
    findByUserId: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const outbox: DeliveryOutboxPort = { append: outboxAppend }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const watchdog: CourierDepartSlaWatchdogQueuePort = { schedule: watchdogSchedule, cancel: watchdogCancel }
  const clock: Clock = { now: () => NOW }
  return {
    useCase: new ReassignDeliveryUseCase(assignments, couriers, outbox, uow, watchdog, clock),
    assignmentsSave,
    outboxAppend,
    watchdogCancel,
    watchdogSchedule,
  }
}

describe('ReassignDeliveryUseCase', () => {
  it('SRS-DELIV-034: en_route_to_pharmacy -> reassign -> assigned на нового курьера, старый watchdog отменён, новый запланирован', async () => {
    const { useCase, assignmentsSave, outboxAppend, watchdogCancel, watchdogSchedule } = makeUseCase()

    const result = await useCase.execute({
      assignmentId: ASSIGNMENT_ID,
      newCourierId: NEW_COURIER_ID,
      reason: 'Курьер не отвечает',
      actor: { userId: 'admin-1', role: 'super_admin', chainId: null },
    })

    expect(result.deliveryAssignmentId).toBe(ASSIGNMENT_ID)
    const saved = assignmentsSave.mock.calls[0]?.[0] as DeliveryAssignment
    expect(saved.status).toBe('assigned')
    expect(saved.courierId).toBe(NEW_COURIER_ID)
    expect(outboxAppend).toHaveBeenCalled()
    expect(watchdogCancel).toHaveBeenCalledWith(ASSIGNMENT_ID)
    expect(watchdogSchedule).toHaveBeenCalledWith({ deliveryAssignmentId: ASSIGNMENT_ID, delayMinutes: expect.any(Number) as number })
  })

  it('unassigned -> reassign недопустим (isReassignableStatus) -> ForbiddenTransitionError', async () => {
    const { useCase } = makeUseCase({ assignment: makeAssignment('unassigned') })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, newCourierId: NEW_COURIER_ID, reason: 'x', actor: { userId: 'a', role: 'super_admin', chainId: null } }),
    ).rejects.toBeInstanceOf(ForbiddenTransitionError)
  })

  it('терминальный delivered -> reassign недопустим -> ForbiddenTransitionError', async () => {
    const { useCase } = makeUseCase({ assignment: makeAssignment('delivered') })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, newCourierId: NEW_COURIER_ID, reason: 'x', actor: { userId: 'a', role: 'super_admin', chainId: null } }),
    ).rejects.toBeInstanceOf(ForbiddenTransitionError)
  })

  it('reason пустой (обход Zod, домен — вторая линия обороны) -> ValidationError', async () => {
    const { useCase } = makeUseCase()

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, newCourierId: NEW_COURIER_ID, reason: '  ', actor: { userId: 'a', role: 'super_admin', chainId: null } }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('pharmacy_admin, курьер платформенного пула -> ForbiddenError', async () => {
    const { useCase } = makeUseCase({ courier: makeCourier(null) })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, newCourierId: NEW_COURIER_ID, reason: 'x', actor: { userId: 'pa', role: 'pharmacy_admin', chainId: 'chain-A' } }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('новый курьер не найден -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ courier: null })

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, newCourierId: NEW_COURIER_ID, reason: 'x', actor: { userId: 'a', role: 'super_admin', chainId: null } }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
