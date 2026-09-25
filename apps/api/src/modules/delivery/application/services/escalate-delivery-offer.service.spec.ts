import { describe, expect, it, vi } from 'vitest'
import type { Clock, IdGenerator } from '@/shared-kernel/index.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import { DeliveryOffer } from '../../domain/delivery-offer.entity.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import type { DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { CachedCandidate, DeliveryCandidateCachePort } from '../ports/delivery-candidate-cache.port.js'
import type { DeliveryOfferTimeoutQueuePort } from '../ports/delivery-offer-timeout-queue.port.js'
import type { BuildCourierCandidateQueryService, AssignmentContext } from './build-courier-candidate-query.service.js'
import type { SuggestNearestCourierUseCase } from '../use-cases/suggest-nearest-courier.use-case.js'
import { EscalateDeliveryOfferService } from './escalate-delivery-offer.service.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ORDER_ID = 'order-1'
const ASSIGNMENT_ID = 'assignment-1'
const NEW_OFFER_ID = 'offer-2'

function makeAssignment(status: DeliveryAssignmentSnapshot['status'] = 'unassigned'): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    courierId: null,
    status,
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

function makeExistingOffer(courierId: string, sequenceNo: number): DeliveryOffer {
  return DeliveryOffer.create({
    id: `offer-seq-${String(sequenceNo)}`,
    deliveryAssignmentId: ASSIGNMENT_ID,
    courierId,
    sequenceNo,
    distanceMeters: 500,
    score: 0.7,
    offeredAt: NOW,
    expiresAt: new Date(NOW.getTime() - 1000),
  })
}

interface Harness {
  readonly service: EscalateDeliveryOfferService
  readonly offersSave: ReturnType<typeof vi.fn>
  readonly outboxAppend: ReturnType<typeof vi.fn>
  readonly timeoutSchedule: ReturnType<typeof vi.fn>
  readonly candidateCacheSet: ReturnType<typeof vi.fn>
  readonly suggestExecute: ReturnType<typeof vi.fn>
}

function makeService(params: {
  assignment?: DeliveryAssignment | null
  existingOffers?: DeliveryOffer[]
  cachedCandidates?: readonly CachedCandidate[] | null
}): Harness {
  const offersSave = vi.fn().mockResolvedValue(undefined)
  const outboxAppend = vi.fn().mockResolvedValue(undefined)
  const timeoutSchedule = vi.fn().mockResolvedValue(undefined)
  const candidateCacheSet = vi.fn().mockResolvedValue(undefined)
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.assignment === undefined ? makeAssignment() : params.assignment),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    save: vi.fn(),
  }
  const offers: DeliveryOfferRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByIdForUpdate: vi.fn().mockResolvedValue(null),
    findPendingByCourierId: vi.fn().mockResolvedValue([]),
    findByAssignmentId: vi.fn().mockResolvedValue(params.existingOffers ?? []),
    save: offersSave,
  }
  const outbox: DeliveryOutboxPort = { append: outboxAppend }
  const candidateCache: DeliveryCandidateCachePort = {
    get: vi.fn().mockResolvedValue(params.cachedCandidates === undefined ? null : params.cachedCandidates),
    set: candidateCacheSet,
  }
  const timeoutQueue: DeliveryOfferTimeoutQueuePort = { schedule: timeoutSchedule, cancel: vi.fn() }
  const geo = GeoPoint.create(38.5598, 68.787)
  if (!geo.ok) throw new Error('fixture error')
  const context: AssignmentContext = {
    order: { orderId: ORDER_ID, tenantId: 'tenant-1', pharmacyId: 'pharmacy-1', medicineIds: [], itemsCount: 1, paymentMethod: 'cash_courier', deliveryGeoPoint: null },
    pharmacy: { id: 'pharmacy-1', name: 'Pharmacy', addressText: 'Addr', geoPoint: geo.value, chainId: null },
    requiresColdChain: false,
    candidateQuery: { tenantId: 'tenant-1', pharmacyChainId: null, pharmacyGeoPoint: geo.value, requiresColdChain: false },
  }
  const buildQuery = { execute: vi.fn().mockResolvedValue(context) } as unknown as BuildCourierCandidateQueryService
  const suggestExecute = vi.fn().mockResolvedValue([{ courierId: 'courier-fresh', courierChainId: null, distanceMeters: 400, totalScore: 0.6 }])
  const suggestCourier = { execute: suggestExecute } as unknown as SuggestNearestCourierUseCase
  const ids: IdGenerator = { next: vi.fn(() => NEW_OFFER_ID) }
  const clock: Clock = { now: () => NOW }
  return {
    service: new EscalateDeliveryOfferService(assignments, offers, outbox, candidateCache, timeoutQueue, buildQuery, suggestCourier, ids, clock),
    offersSave,
    outboxAppend,
    timeoutSchedule,
    candidateCacheSet,
    suggestExecute,
  }
}

describe('EscalateDeliveryOfferService', () => {
  it('кандидат из кэша ещё не был приглашён -> создаёт оффер sequence_no=maxExisting+1, планирует таймаут, публикует DeliveryOfferCreatedEvent', async () => {
    const cached: CachedCandidate[] = [
      { courierId: 'courier-1', distanceMeters: 300, score: 0.9 },
      { courierId: 'courier-2', distanceMeters: 800, score: 0.5 },
    ]
    const { service, offersSave, outboxAppend, timeoutSchedule } = makeService({
      existingOffers: [makeExistingOffer('courier-1', 1)],
      cachedCandidates: cached,
    })

    await service.execute(ASSIGNMENT_ID, undefined)

    const savedOffer = offersSave.mock.calls[0]?.[0] as DeliveryOffer
    expect(savedOffer.courierId).toBe('courier-2')
    expect(savedOffer.sequenceNo).toBe(2)
    expect(timeoutSchedule).toHaveBeenCalledWith({ offerId: NEW_OFFER_ID, delaySeconds: expect.any(Number) as number })
    const [publishedEvent] = outboxAppend.mock.calls[0] as [unknown]
    expect(publishedEvent).toMatchObject({ type: 'DeliveryOfferCreatedEvent', sequenceNo: 2, courierId: 'courier-2' })
  })

  it('все кандидаты кэша уже приглашены -> DeliveryEscalatedToPoolEvent, оффер не создаётся', async () => {
    const cached: CachedCandidate[] = [{ courierId: 'courier-1', distanceMeters: 300, score: 0.9 }]
    const { service, offersSave, outboxAppend } = makeService({
      existingOffers: [makeExistingOffer('courier-1', 1)],
      cachedCandidates: cached,
    })

    await service.execute(ASSIGNMENT_ID, undefined)

    expect(offersSave).not.toHaveBeenCalled()
    const [publishedEvent] = outboxAppend.mock.calls[0] as [unknown]
    expect(publishedEvent).toMatchObject({ type: 'DeliveryEscalatedToPoolEvent', deliveryAssignmentId: ASSIGNMENT_ID, orderId: ORDER_ID })
  })

  it('кэш истёк (промах) -> пересчитывает через SuggestNearestCourierUseCase и кэширует заново', async () => {
    const { service, offersSave, candidateCacheSet, suggestExecute } = makeService({ existingOffers: [], cachedCandidates: null })

    await service.execute(ASSIGNMENT_ID, undefined)

    expect(suggestExecute).toHaveBeenCalledTimes(1)
    expect(candidateCacheSet).toHaveBeenCalledWith(ASSIGNMENT_ID, [{ courierId: 'courier-fresh', distanceMeters: 400, score: 0.6 }])
    const savedOffer = offersSave.mock.calls[0]?.[0] as DeliveryOffer
    expect(savedOffer.courierId).toBe('courier-fresh')
  })

  it('назначение уже разрешено иначе (status != unassigned) -> no-op', async () => {
    const { service, offersSave, outboxAppend } = makeService({ assignment: makeAssignment('assigned') })

    await service.execute(ASSIGNMENT_ID, undefined)

    expect(offersSave).not.toHaveBeenCalled()
    expect(outboxAppend).not.toHaveBeenCalled()
  })

  it('назначение не найдено -> no-op', async () => {
    const { service, outboxAppend } = makeService({ assignment: null })

    await service.execute(ASSIGNMENT_ID, undefined)

    expect(outboxAppend).not.toHaveBeenCalled()
  })
})
