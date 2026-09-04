/**
 * `DeliveryOffer` — сущность очереди последовательных предложений курьерам (EP-13, DTJ-313,
 * `25-module-courier-delivery.md` §D.3, SRS-DELIV-005). Мутируемый стиль + `_domainEvents`
 * (тот же приём, что `DeliveryAssignment`/`Order` — сущность эмитирует события).
 */
import { OfferAlreadyRespondedError, OfferExpiredError, ValidationError, type DeliveryOfferStatus } from '@dorutj/contracts'
import type { DeliveryDomainEvent } from './delivery-domain-event.js'

export interface DeliveryOfferCreateCommand {
  readonly id: string
  readonly deliveryAssignmentId: string
  readonly courierId: string
  readonly sequenceNo: number
  readonly distanceMeters: number
  readonly score: number
  readonly offeredAt: Date
  readonly expiresAt: Date
}

export interface DeliveryOfferSnapshot {
  readonly id: string
  readonly deliveryAssignmentId: string
  readonly courierId: string
  readonly sequenceNo: number
  readonly status: DeliveryOfferStatus
  readonly distanceMeters: number
  readonly score: number
  readonly offeredAt: Date
  readonly expiresAt: Date
  readonly respondedAt: Date | null
  readonly declineReason: string | null
}

export class DeliveryOffer {
  readonly id: string
  readonly deliveryAssignmentId: string
  readonly courierId: string
  readonly sequenceNo: number
  readonly distanceMeters: number
  readonly score: number
  readonly offeredAt: Date
  readonly expiresAt: Date

  private _status: DeliveryOfferStatus
  private _respondedAt: Date | null
  private _declineReason: string | null
  private _domainEvents: DeliveryDomainEvent[] = []

  private constructor(s: DeliveryOfferSnapshot) {
    this.id = s.id
    this.deliveryAssignmentId = s.deliveryAssignmentId
    this.courierId = s.courierId
    this.sequenceNo = s.sequenceNo
    this.distanceMeters = s.distanceMeters
    this.score = s.score
    this.offeredAt = s.offeredAt
    this.expiresAt = s.expiresAt
    this._status = s.status
    this._respondedAt = s.respondedAt
    this._declineReason = s.declineReason
  }

  get status(): DeliveryOfferStatus {
    return this._status
  }

  /** `chk_delivery_offers_sequence_positive` — 1..N по порядку эскалации. */
  static create(cmd: DeliveryOfferCreateCommand): DeliveryOffer {
    if (cmd.sequenceNo <= 0) {
      throw new ValidationError('sequenceNo must be positive', { field: 'sequenceNo', value: cmd.sequenceNo })
    }
    const offer = new DeliveryOffer({
      id: cmd.id,
      deliveryAssignmentId: cmd.deliveryAssignmentId,
      courierId: cmd.courierId,
      sequenceNo: cmd.sequenceNo,
      status: 'pending',
      distanceMeters: cmd.distanceMeters,
      score: cmd.score,
      offeredAt: cmd.offeredAt,
      expiresAt: cmd.expiresAt,
      respondedAt: null,
      declineReason: null,
    })
    offer._domainEvents.push({
      type: 'DeliveryOfferCreatedEvent',
      offerId: cmd.id,
      deliveryAssignmentId: cmd.deliveryAssignmentId,
      courierId: cmd.courierId,
      sequenceNo: cmd.sequenceNo,
      expiresAt: cmd.expiresAt,
    })
    return offer
  }

  static restore(snapshot: DeliveryOfferSnapshot): DeliveryOffer {
    return new DeliveryOffer(snapshot)
  }

  /** SRS-DELIV-013 — `pending → accepted`. Given `now > expires_at` (гонка) → `OfferExpiredError`. */
  accept(now: Date): void {
    this.assertPending()
    if (now > this.expiresAt) {
      throw new OfferExpiredError({ offerId: this.id })
    }
    this._status = 'accepted'
    this._respondedAt = now
  }

  /** SRS-DELIV-014 — `pending → declined`, немедленно триггерит эскалацию (application-слой). */
  decline(reason: string | null, now: Date): void {
    this.assertPending()
    this._status = 'declined'
    this._respondedAt = now
    this._declineReason = reason
  }

  /** SRS-DELIV-039 — BullMQ timeout job, `jobId=offerId` идемпотентен. Given уже НЕ pending
   * (ответили раньше таймера) — `OfferAlreadyRespondedError`, use case ловит и no-op'ит. */
  expire(now: Date): void {
    this.assertPending()
    this._status = 'expired'
    this._respondedAt = now
    this._domainEvents.push({
      type: 'DeliveryOfferExpiredEvent',
      offerId: this.id,
      deliveryAssignmentId: this.deliveryAssignmentId,
      courierId: this.courierId,
    })
  }

  /** SRS-DELIV-033 — `assign-manual` отменяет все pending-офферы назначения. */
  supersede(now: Date): void {
    this.assertPending()
    this._status = 'superseded'
    this._respondedAt = now
  }

  pullDomainEvents(): DeliveryDomainEvent[] {
    const events = this._domainEvents
    this._domainEvents = []
    return events
  }

  toSnapshot(): DeliveryOfferSnapshot {
    return {
      id: this.id,
      deliveryAssignmentId: this.deliveryAssignmentId,
      courierId: this.courierId,
      sequenceNo: this.sequenceNo,
      status: this._status,
      distanceMeters: this.distanceMeters,
      score: this.score,
      offeredAt: this.offeredAt,
      expiresAt: this.expiresAt,
      respondedAt: this._respondedAt,
      declineReason: this._declineReason,
    }
  }

  private assertPending(): void {
    if (this._status !== 'pending') {
      throw new OfferAlreadyRespondedError({ offerId: this.id, status: this._status })
    }
  }
}
