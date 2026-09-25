import { describe, expect, it, vi } from 'vitest'
import type { Clock } from '@/shared-kernel/index.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { ResolveCourierDepartSlaWatchdogUseCase } from './resolve-courier-depart-sla-watchdog.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'

function makeAssignment(status: DeliveryAssignmentSnapshot['status']): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    courierId: 'courier-1',
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

function makeUseCase(assignment: DeliveryAssignment | null): { useCase: ResolveCourierDepartSlaWatchdogUseCase; outboxAppend: ReturnType<typeof vi.fn> } {
  const outboxAppend = vi.fn().mockResolvedValue(undefined)
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(assignment),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    save: vi.fn().mockResolvedValue(undefined),
    claimUnassigned: vi.fn().mockResolvedValue(true),
    assignManual: vi.fn().mockResolvedValue(true),
    findUnassignedPool: vi.fn().mockResolvedValue([]),
    findByStatuses: vi.fn().mockResolvedValue([]),
  }
  const outbox: DeliveryOutboxPort = { append: outboxAppend }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const clock: Clock = { now: () => NOW }
  return { useCase: new ResolveCourierDepartSlaWatchdogUseCase(assignments, outbox, uow, clock), outboxAppend }
}

describe('ResolveCourierDepartSlaWatchdogUseCase', () => {
  it('TC-DELIV-063: назначение всё ещё assigned (курьер не выехал) -> SlaBreachedEvent опубликован, статус НЕ меняется', async () => {
    const { useCase, outboxAppend } = makeUseCase(makeAssignment('assigned'))

    await useCase.execute({ deliveryAssignmentId: ASSIGNMENT_ID })

    expect(outboxAppend).toHaveBeenCalledTimes(1)
    const [publishedEvent] = outboxAppend.mock.calls[0] as [unknown]
    expect(publishedEvent).toMatchObject({
      type: 'SlaBreachedEvent',
      deliveryAssignmentId: ASSIGNMENT_ID,
      orderId: ORDER_ID,
      entityType: 'delivery_assignment',
    })
  })

  it('курьер уже выехал (en_route_to_pharmacy) -> idempotent no-op', async () => {
    const { useCase, outboxAppend } = makeUseCase(makeAssignment('en_route_to_pharmacy'))

    await useCase.execute({ deliveryAssignmentId: ASSIGNMENT_ID })

    expect(outboxAppend).not.toHaveBeenCalled()
  })

  it('назначение не найдено -> idempotent no-op, не бросает', async () => {
    const { useCase, outboxAppend } = makeUseCase(null)

    await expect(useCase.execute({ deliveryAssignmentId: ASSIGNMENT_ID })).resolves.toBeUndefined()
    expect(outboxAppend).not.toHaveBeenCalled()
  })
})
