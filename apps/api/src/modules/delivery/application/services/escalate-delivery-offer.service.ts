// Общая логика "следующий кандидат" — вызывается DeclineDeliveryOfferUseCase и ResolveDeliveryOfferTimeoutUseCase (не дублируется). Ожидает активную транзакцию вызывающего.
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { DeliveryOffer } from '../../domain/delivery-offer.entity.js'
import type { DeliveryDomainEvent } from '../../domain/delivery-domain-event.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { DELIVERY_OFFER_REPOSITORY, type DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkTx } from '../ports/delivery-unit-of-work.port.js'
import { DELIVERY_CANDIDATE_CACHE_PORT, type CachedCandidate, type DeliveryCandidateCachePort } from '../ports/delivery-candidate-cache.port.js'
import {
  DELIVERY_OFFER_TIMEOUT_QUEUE,
  type DeliveryOfferTimeoutQueuePort,
} from '../ports/delivery-offer-timeout-queue.port.js'
import { BuildCourierCandidateQueryService } from './build-courier-candidate-query.service.js'
import { SuggestNearestCourierUseCase } from '../use-cases/suggest-nearest-courier.use-case.js'
import { resolveOfferAcceptTimeoutSeconds } from '../use-cases/delivery-offer-timing.util.js'

@Injectable()
export class EscalateDeliveryOfferService {
  // eslint-disable-next-line max-params -- 9 DI-инъекций, явные @Inject (DTJ-001)
  public constructor(
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_OFFER_REPOSITORY) private readonly offers: DeliveryOfferRepositoryPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(DELIVERY_CANDIDATE_CACHE_PORT) private readonly candidateCache: DeliveryCandidateCachePort,
    @Inject(DELIVERY_OFFER_TIMEOUT_QUEUE) private readonly timeoutQueue: DeliveryOfferTimeoutQueuePort,
    @Inject(BuildCourierCandidateQueryService) private readonly buildQuery: BuildCourierCandidateQueryService,
    @Inject(SuggestNearestCourierUseCase) private readonly suggestCourier: SuggestNearestCourierUseCase,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(assignmentId: string, tx: DeliveryUnitOfWorkTx): Promise<void> {
    const assignment = await this.assignments.findById(assignmentId, tx)
    if (assignment?.status !== 'unassigned') {
      return // назначение уже разрешено иначе (принято/переназначено вручную) — эскалация неактуальна
    }
    const existingOffers = await this.offers.findByAssignmentId(assignmentId, tx)
    const offeredCourierIds = new Set(existingOffers.map((o) => o.courierId))
    const maxSequence = existingOffers.reduce((max, o) => Math.max(max, o.sequenceNo), 0)

    const candidates = await this.resolveCandidates(assignment.orderId, assignmentId)
    const next = candidates.find((c) => !offeredCourierIds.has(c.courierId))

    const event =
      next === undefined
        ? this.buildExhaustedEvent(assignment.orderId, assignmentId)
        : await this.createNextOffer({ assignmentId, candidate: next, sequenceNo: maxSequence + 1, tx })
    await this.outbox.append(event, null, tx)
  }

  private async resolveCandidates(orderId: string, assignmentId: string): Promise<readonly CachedCandidate[]> {
    const cached = await this.candidateCache.get(assignmentId)
    if (cached !== null) return cached
    const context = await this.buildQuery.execute(orderId)
    const fresh = await this.suggestCourier.execute(context.candidateQuery)
    const mapped = fresh.map((c) => ({ courierId: c.courierId, distanceMeters: c.distanceMeters, score: c.totalScore }))
    await this.candidateCache.set(assignmentId, mapped)
    return mapped
  }

  private buildExhaustedEvent(orderId: string, assignmentId: string): DeliveryDomainEvent {
    return { type: 'DeliveryEscalatedToPoolEvent', deliveryAssignmentId: assignmentId, orderId, candidatesExhausted: true }
  }

  private async createNextOffer(input: {
    readonly assignmentId: string
    readonly candidate: CachedCandidate
    readonly sequenceNo: number
    readonly tx: DeliveryUnitOfWorkTx
  }): Promise<DeliveryDomainEvent> {
    const { assignmentId, candidate, sequenceNo, tx } = input
    const now = this.clock.now()
    const expiresAt = new Date(now.getTime() + resolveOfferAcceptTimeoutSeconds() * 1000)
    const offer = DeliveryOffer.create({
      id: this.ids.next(),
      deliveryAssignmentId: assignmentId,
      courierId: candidate.courierId,
      sequenceNo,
      distanceMeters: candidate.distanceMeters,
      score: candidate.score,
      offeredAt: now,
      expiresAt,
    })
    await this.offers.save(offer, tx)
    await this.timeoutQueue.schedule({ offerId: offer.id, delaySeconds: resolveOfferAcceptTimeoutSeconds() }) // сбой Redis откатывает эскалацию
    const createdEvent = offer.pullDomainEvents()[0]
    if (createdEvent === undefined) {
      throw new Error('DeliveryOffer.create(): expected DeliveryOfferCreatedEvent — invariant violation')
    }
    return createdEvent
  }
}
