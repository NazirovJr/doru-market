import { describe, expect, it, vi } from 'vitest'
import type { Clock, IdGenerator } from '@/shared-kernel/index.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryOffer } from '../../domain/delivery-offer.entity.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import type { DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import type { DeliveryCandidateCachePort } from '../ports/delivery-candidate-cache.port.js'
import type { DeliveryOfferTimeoutQueuePort } from '../ports/delivery-offer-timeout-queue.port.js'
import type { BuildCourierCandidateQueryService, AssignmentContext } from '../services/build-courier-candidate-query.service.js'
import type { SuggestNearestCourierUseCase, ScoredCourierCandidate } from './suggest-nearest-courier.use-case.js'
import { CreateDeliveryAssignmentUseCase } from './create-delivery-assignment.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ORDER_ID = 'order-1'
const ASSIGNMENT_ID = 'assignment-new'
const OFFER_ID = 'offer-new'
const TENANT_ID = 'tenant-1'

function makeContext(overrides: Partial<AssignmentContext> = {}): AssignmentContext {
  const geo = GeoPoint.create(38.5598, 68.787)
  if (!geo.ok) throw new Error('fixture error')
  return {
    order: { orderId: ORDER_ID, tenantId: TENANT_ID, pharmacyId: 'pharmacy-1', medicineIds: [], itemsCount: 1, paymentMethod: 'cash_courier', deliveryGeoPoint: null },
    pharmacy: { id: 'pharmacy-1', name: 'Pharmacy', addressText: 'Addr', geoPoint: geo.value, chainId: null },
    requiresColdChain: false,
    candidateQuery: { tenantId: TENANT_ID, pharmacyChainId: null, pharmacyGeoPoint: geo.value, requiresColdChain: false },
    ...overrides,
  }
}

function makeCandidate(courierId: string, distanceMeters = 500, totalScore = 0.8): ScoredCourierCandidate {
  return { courierId, courierChainId: null, distanceMeters, totalScore }
}

function makeExistingAssignment(): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: 'existing-assignment',
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

interface Harness {
  readonly useCase: CreateDeliveryAssignmentUseCase
  readonly assignmentsSave: ReturnType<typeof vi.fn>
  readonly offersSave: ReturnType<typeof vi.fn>
  readonly outboxAppend: ReturnType<typeof vi.fn>
  readonly timeoutSchedule: ReturnType<typeof vi.fn>
  readonly candidateCacheSet: ReturnType<typeof vi.fn>
}

function makeUseCase(params: { existing?: DeliveryAssignment | null; candidates?: ScoredCourierCandidate[]; context?: AssignmentContext } = {}): Harness {
  const assignmentsSave = vi.fn().mockResolvedValue(undefined)
  const offersSave = vi.fn().mockResolvedValue(undefined)
  const outboxAppend = vi.fn().mockResolvedValue(undefined)
  const timeoutSchedule = vi.fn().mockResolvedValue(undefined)
  const candidateCacheSet = vi.fn().mockResolvedValue(undefined)
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findActiveByOrderId: vi.fn().mockResolvedValue(params.existing === undefined ? null : params.existing),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    save: assignmentsSave,
  }
  const offers: DeliveryOfferRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByIdForUpdate: vi.fn().mockResolvedValue(null),
    findPendingByCourierId: vi.fn().mockResolvedValue([]),
    findByAssignmentId: vi.fn().mockResolvedValue([]),
    save: offersSave,
  }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const outbox: DeliveryOutboxPort = { append: outboxAppend }
  const candidateCache: DeliveryCandidateCachePort = { get: vi.fn().mockResolvedValue(null), set: candidateCacheSet }
  const timeoutQueue: DeliveryOfferTimeoutQueuePort = { schedule: timeoutSchedule, cancel: vi.fn().mockResolvedValue(undefined) }
  const buildQuery = { execute: vi.fn().mockResolvedValue(params.context ?? makeContext()) } as unknown as BuildCourierCandidateQueryService
  const suggestCourier = {
    execute: vi.fn().mockResolvedValue(params.candidates ?? [makeCandidate('courier-1')]),
  } as unknown as SuggestNearestCourierUseCase
  const ids: IdGenerator = { next: vi.fn().mockReturnValueOnce(ASSIGNMENT_ID).mockReturnValueOnce(OFFER_ID) }
  const clock: Clock = { now: () => NOW }
  return {
    useCase: new CreateDeliveryAssignmentUseCase(assignments, offers, uow, outbox, candidateCache, timeoutQueue, buildQuery, suggestCourier, ids, clock),
    assignmentsSave,
    offersSave,
    outboxAppend,
    timeoutSchedule,
    candidateCacheSet,
  }
}

describe('CreateDeliveryAssignmentUseCase', () => {
  it('SRS-DOM-036: активное назначение уже есть -> идемпотентный no-op, ничего не создаётся', async () => {
    const { useCase, assignmentsSave, offersSave, outboxAppend } = makeUseCase({ existing: makeExistingAssignment() })

    const result = await useCase.execute(ORDER_ID)

    expect(result).toEqual({ created: false, assignmentId: 'existing-assignment' })
    expect(assignmentsSave).not.toHaveBeenCalled()
    expect(offersSave).not.toHaveBeenCalled()
    expect(outboxAppend).not.toHaveBeenCalled()
  })

  it('happy path: создаёт назначение (requiresColdChain из контекста) + оффер sequence_no=1 первому кандидату, планирует таймаут, публикует DeliveryOfferCreatedEvent', async () => {
    const { useCase, assignmentsSave, offersSave, outboxAppend, timeoutSchedule, candidateCacheSet } = makeUseCase({
      context: makeContext({ requiresColdChain: true }),
      candidates: [makeCandidate('courier-1', 300, 0.9), makeCandidate('courier-2', 800, 0.5)],
    })

    const result = await useCase.execute(ORDER_ID)

    expect(result).toEqual({ created: true, assignmentId: ASSIGNMENT_ID })
    const savedAssignment = assignmentsSave.mock.calls[0]?.[0] as DeliveryAssignment
    expect(savedAssignment.toSnapshot().requiresColdChain).toBe(true)
    const savedOffer = offersSave.mock.calls[0]?.[0] as DeliveryOffer
    expect(savedOffer.sequenceNo).toBe(1)
    expect(savedOffer.courierId).toBe('courier-1')
    expect(timeoutSchedule).toHaveBeenCalledWith({ offerId: OFFER_ID, delaySeconds: expect.any(Number) as number })
    expect(candidateCacheSet).toHaveBeenCalledWith(ASSIGNMENT_ID, [
      { courierId: 'courier-1', distanceMeters: 300, score: 0.9 },
      { courierId: 'courier-2', distanceMeters: 800, score: 0.5 },
    ])
    const [publishedEvent] = outboxAppend.mock.calls[0] as [unknown, unknown]
    expect(publishedEvent).toMatchObject({ type: 'DeliveryOfferCreatedEvent', deliveryAssignmentId: ASSIGNMENT_ID, courierId: 'courier-1', sequenceNo: 1 })
  })

  it('нет доступных кандидатов -> публикует DeliveryEscalatedToPoolEvent, оффер не создаётся', async () => {
    const { useCase, offersSave, outboxAppend, timeoutSchedule } = makeUseCase({ candidates: [] })

    await useCase.execute(ORDER_ID)

    expect(offersSave).not.toHaveBeenCalled()
    expect(timeoutSchedule).not.toHaveBeenCalled()
    const [publishedEvent] = outboxAppend.mock.calls[0] as [unknown]
    expect(publishedEvent).toMatchObject({ type: 'DeliveryEscalatedToPoolEvent', deliveryAssignmentId: ASSIGNMENT_ID, orderId: ORDER_ID, candidatesExhausted: true })
  })
})
