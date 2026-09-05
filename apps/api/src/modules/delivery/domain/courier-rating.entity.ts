/**
 * `CourierRating` — оценка курьера клиентом (EP-13, DTJ-313, `25-module-courier-delivery.md` §D.5,
 * SRS-DELIV-007). Append-only (одна оценка на заказ, `UNIQUE(order_id)` на уровне БД) — нет
 * методов-намерения после создания, только фабрика (тот же принцип, что `EscrowLedgerEntry`,
 * `10-domain-model.md` SRS-DOM-031).
 */
import { ValidationError } from '@dorutj/contracts'
import type { DeliveryDomainEvent } from './delivery-domain-event.js'

const RATING_MIN = 1
const RATING_MAX = 5

export interface CourierRatingCreateCommand {
  readonly id: string
  readonly orderId: string
  readonly courierId: string
  readonly customerId: string
  readonly rating: number
  readonly comment: string | null
  readonly now: Date
}

export interface CourierRatingSnapshot {
  readonly id: string
  readonly orderId: string
  readonly courierId: string
  readonly customerId: string
  readonly rating: number
  readonly comment: string | null
  readonly createdAt: Date
}

export class CourierRating {
  readonly id: string
  readonly orderId: string
  readonly courierId: string
  readonly customerId: string
  readonly rating: number
  readonly comment: string | null
  readonly createdAt: Date

  private readonly _domainEvents: DeliveryDomainEvent[]

  private constructor(s: CourierRatingSnapshot, domainEvents: DeliveryDomainEvent[]) {
    this.id = s.id
    this.orderId = s.orderId
    this.courierId = s.courierId
    this.customerId = s.customerId
    this.rating = s.rating
    this.comment = s.comment
    this.createdAt = s.createdAt
    this._domainEvents = domainEvents
  }

  /** `chk_courier_ratings_range` — доступна только для `delivered`-заказа, проверка application-слоя
   * (SRS-DELIV-032); `RatingAlreadySubmittedError` бросает вызывающий код при нарушении
   * `UNIQUE(order_id)` (репозиторий), не эта фабрика — здесь только структурный инвариант оценки. */
  static create(cmd: CourierRatingCreateCommand): CourierRating {
    if (!Number.isInteger(cmd.rating) || cmd.rating < RATING_MIN || cmd.rating > RATING_MAX) {
      throw new ValidationError('Invalid rating: expected integer between 1 and 5', { field: 'rating' })
    }
    const snapshot: CourierRatingSnapshot = {
      id: cmd.id,
      orderId: cmd.orderId,
      courierId: cmd.courierId,
      customerId: cmd.customerId,
      rating: cmd.rating,
      comment: cmd.comment,
      createdAt: cmd.now,
    }
    return new CourierRating(snapshot, [
      { type: 'CourierRatedEvent', orderId: cmd.orderId, courierId: cmd.courierId, rating: cmd.rating },
    ])
  }

  static restore(snapshot: CourierRatingSnapshot): CourierRating {
    return new CourierRating(snapshot, [])
  }

  pullDomainEvents(): DeliveryDomainEvent[] {
    return [...this._domainEvents]
  }

  toSnapshot(): CourierRatingSnapshot {
    return {
      id: this.id,
      orderId: this.orderId,
      courierId: this.courierId,
      customerId: this.customerId,
      rating: this.rating,
      comment: this.comment,
      createdAt: this.createdAt,
    }
  }
}
