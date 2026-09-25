import { Inject, Injectable } from '@nestjs/common'
import { BusinessRuleViolationError, ForbiddenError, NotFoundError, RatingAlreadySubmittedError } from '@dorutj/contracts'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { CourierRating, type CourierRatingSnapshot } from '../../domain/courier-rating.entity.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import {
  COURIER_RATING_REPOSITORY,
  type CourierRatingRepositoryPort,
} from '../ports/courier-rating.repository.port.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrdersPort, type OrderRatingContext } from '../ports/delivery-orders.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
} from '../ports/delivery-unit-of-work.port.js'

export type { CourierRatingSnapshot }

const DELIVERED_ORDER_STATUS = 'delivered'

export interface SubmitCourierRatingInput {
  readonly tenantId: string
  readonly customerId: string
  readonly orderId: string
  readonly rating: number
  readonly comment: string | null
}

@Injectable()
export class SubmitCourierRatingUseCase {
  // eslint-disable-next-line max-params -- 8 DI-инъекций конструктора
  public constructor(
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(COURIER_RATING_REPOSITORY) private readonly ratings: CourierRatingRepositoryPort,
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(input: SubmitCourierRatingInput): Promise<CourierRatingSnapshot> {
    const order = await this.orders.getOrderForRating(input.tenantId, input.orderId)
    this.assertRatingEligible(order, input)

    return this.uow.run(async (tx) => {
      const alreadyRated = await this.ratings.existsByOrderId(input.orderId, tx)
      if (alreadyRated) {
        throw new RatingAlreadySubmittedError({ orderId: input.orderId })
      }
      const assignment = await this.assignments.findByOrderId(input.orderId, tx)
      if (assignment?.courierId == null) {
        throw new NotFoundError({ orderId: input.orderId, reason: 'no delivery assignment/courier for order' })
      }
      const courier = await this.couriers.findById(assignment.courierId, tx)
      if (courier === null) {
        throw new NotFoundError({ courierId: assignment.courierId })
      }

      const rating = CourierRating.create({
        id: this.ids.next(),
        orderId: input.orderId,
        courierId: assignment.courierId,
        customerId: input.customerId,
        rating: input.rating,
        comment: input.comment,
        now: this.clock.now(),
      })
      const updatedCourier = courier.applyRating(input.rating)
      await this.ratings.save(rating, tx)
      await this.couriers.save(updatedCourier, tx)
      for (const event of rating.pullDomainEvents()) {
        // eslint-disable-next-line no-await-in-loop -- одна транзакция/соединение, порядок важен
        await this.outbox.append(event, null, tx)
      }
      return rating.toSnapshot()
    })
  }

  private assertRatingEligible(order: OrderRatingContext | null, input: SubmitCourierRatingInput): void {
    if (order === null) {
      throw new NotFoundError({ orderId: input.orderId })
    }
    if (order.customerId !== input.customerId) {
      throw new ForbiddenError('Order does not belong to the requesting customer', { orderId: input.orderId })
    }
    if (order.status !== DELIVERED_ORDER_STATUS) {
      throw new BusinessRuleViolationError('Courier rating requires a delivered order', {
        orderId: input.orderId,
        status: order.status,
      })
    }
  }
}
