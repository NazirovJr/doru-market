// Идемпотентен: активное назначение для orderId уже есть -> no-op (at-least-once доставка события).
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import { DeliveryOffer } from '../../domain/delivery-offer.entity.js'
import type { DeliveryDomainEvent } from '../../domain/delivery-domain-event.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { DELIVERY_OFFER_REPOSITORY, type DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
  type DeliveryUnitOfWorkTx,
} from '../ports/delivery-unit-of-work.port.js'
import { DELIVERY_CANDIDATE_CACHE_PORT, type DeliveryCandidateCachePort } from '../ports/delivery-candidate-cache.port.js'
import {
  DELIVERY_OFFER_TIMEOUT_QUEUE,
  type DeliveryOfferTimeoutQueuePort,
} from '../ports/delivery-offer-timeout-queue.port.js'
import { BuildCourierCandidateQueryService, type AssignmentContext } from '../services/build-courier-candidate-query.service.js'
import { SuggestNearestCourierUseCase } from './suggest-nearest-courier.use-case.js'
import { resolveOfferAcceptTimeoutSeconds } from './delivery-offer-timing.util.js'

export interface CreateDeliveryAssignmentResult {
  readonly created: boolean
  readonly assignmentId: string
}

@Injectable()
export class CreateDeliveryAssignmentUseCase {
  // eslint-disable-next-line max-params -- 9 DI-инъекций (репозитории/порты/сервисы/Clock/IdGenerator), явные @Inject (DTJ-001)
  public constructor(
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_OFFER_REPOSITORY) private readonly offers: DeliveryOfferRepositoryPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(DELIVERY_CANDIDATE_CACHE_PORT) private readonly candidateCache: DeliveryCandidateCachePort,
    @Inject(DELIVERY_OFFER_TIMEOUT_QUEUE) private readonly timeoutQueue: DeliveryOfferTimeoutQueuePort,
    @Inject(BuildCourierCandidateQueryService) private readonly buildQuery: BuildCourierCandidateQueryService,
    @Inject(SuggestNearestCourierUseCase) private readonly suggestCourier: SuggestNearestCourierUseCase,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(orderId: string): Promise<CreateDeliveryAssignmentResult> {
    const existing = await this.assignments.findActiveByOrderId(orderId)
    if (existing !== null) {
      return { created: false, assignmentId: existing.id }
    }
    const context = await this.buildQuery.execute(orderId)
    return this.uow.run(async (tx) => {
      const raceCheck = await this.assignments.findActiveByOrderId(orderId, tx) // защита от гонки между двумя проверками
      if (raceCheck !== null) {
        return { created: false, assignmentId: raceCheck.id }
      }
      const assignment = await this.createAssignment(orderId, context, tx)
      const events = await this.buildFirstOfferEvents(assignment, context, tx)
      for (const event of events) {
        // eslint-disable-next-line no-await-in-loop -- одна транзакция/соединение, порядок важен
        await this.outbox.append(event, context.order.tenantId, tx)
      }
      return { created: true, assignmentId: assignment.id }
    })
  }

  private async createAssignment(orderId: string, context: AssignmentContext, tx: DeliveryUnitOfWorkTx): Promise<DeliveryAssignment> {
    const created = DeliveryAssignment.create({
      id: this.ids.next(),
      orderId,
      landmarkText: null,
      requiresColdChain: context.requiresColdChain,
      hasActiveNonTerminalAssignment: false,
      now: this.clock.now(),
    })
    if (!created.ok) {
      throw created.error
    }
    await this.assignments.save(created.value, tx)
    return created.value
  }

  private async buildFirstOfferEvents(
    assignment: DeliveryAssignment,
    context: AssignmentContext,
    tx: DeliveryUnitOfWorkTx,
  ): Promise<DeliveryDomainEvent[]> {
    const candidates = await this.suggestCourier.execute(context.candidateQuery)
    await this.candidateCache.set(
      assignment.id,
      candidates.map((c) => ({ courierId: c.courierId, distanceMeters: c.distanceMeters, score: c.totalScore })),
    )
    const events: DeliveryDomainEvent[] = [...assignment.pullDomainEvents()]
    const [first] = candidates
    if (first === undefined) {
      events.push({ type: 'DeliveryEscalatedToPoolEvent', deliveryAssignmentId: assignment.id, orderId: assignment.orderId, candidatesExhausted: true })
      return events
    }
    const now = this.clock.now()
    const offer = DeliveryOffer.create({
      id: this.ids.next(),
      deliveryAssignmentId: assignment.id,
      courierId: first.courierId,
      sequenceNo: 1,
      distanceMeters: first.distanceMeters,
      score: first.totalScore,
      offeredAt: now,
      expiresAt: new Date(now.getTime() + resolveOfferAcceptTimeoutSeconds() * 1000),
    })
    await this.offers.save(offer, tx)
    await this.timeoutQueue.schedule({ offerId: offer.id, delaySeconds: resolveOfferAcceptTimeoutSeconds() }) // сбой Redis откатывает создание назначения
    events.push(...offer.pullDomainEvents())
    return events
  }
}
