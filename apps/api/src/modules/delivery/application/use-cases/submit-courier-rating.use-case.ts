/**
 * `SubmitCourierRatingUseCase` (EP-13, DTJ-321, SRS-DELIV-032) — `POST /api/v1/courier-ratings`.
 *
 * Preconditions (текст тикета п.3, ПО ПОРЯДКУ, первая ошибка обрывает):
 *   1. Заказ существует (в тенанте вызывающего) — иначе `NotFoundError` (404).
 *   2. `order.customerId === actor.customerId` — иначе `ForbiddenError` (403, generic — тот же
 *      приём, что `EndCourierShiftUseCase` для чужой смены, специального кода не заводится).
 *   3. `order.status === 'delivered'` — иначе `BusinessRuleViolationError` (422, generic —
 *      спецификация (`25-module-courier-delivery.md` §A.2) называет явно только
 *      `RATING_ALREADY_SUBMITTED` как «новый код»; для ЭТОГО условия готового кода нет и общий
 *      `BUSINESS_RULE_VIOLATION` — установленный в этой кодовой базе приём для похожих случаев
 *      без выделенного имени, тот же, что `new ConflictError(...)` в `create-staff-account.use-
 *      case.ts` — не заводит новый `ErrorCode` там, где общий уже подходит).
 *   4. Оценка ещё не существует для `orderId` (`existsByOrderId`, ВНУТРИ транзакции — реальный
 *      барьер от гонки — `UNIQUE(order_id)`, тот же риск-профиль, что `ux_courier_shifts_
 *      one_active`) — иначе `RatingAlreadySubmittedError` (409, `RATING_ALREADY_SUBMITTED`,
 *      УЖЕ существующий централизованный код, DTJ-313 — переиспользуется, не дублируется).
 *
 * `courierId` для новой строки — резолвится из `DeliveryAssignmentRepositoryPort.findByOrderId`
 * (ДОБАВЛЕНО этим тикетом в порт, см. её JSDoc): назначение доставленного заказа УЖЕ терминально
 * (`status='delivered'`), `findActiveByOrderId` (нетерминальный фильтр) НЕПРИГОДЕН здесь.
 *
 * `Courier.applyRating()` (DTJ-313) + `CourierRating.create()` (DTJ-313) сохраняются ОДНОЙ
 * транзакцией (DoD тикета: «пересчёт rating_avg атомарен со вставкой оценки») —
 * `DeliveryUnitOfWorkPort`, тот же приём, что `EndCourierShiftUseCase` (DTJ-320).
 * `CourierRatedEvent` (уже в буфере `CourierRating.create()`, DTJ-313) публикуется через
 * `DeliveryOutboxPort` В ТОЙ ЖЕ транзакции — 1:1 приём `EndCourierShiftUseCase` для
 * `CashReconciliationDiscrepancyEvent`.
 */
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

/** Re-export для `presentation` (`courier-ratings.controller.ts`) — `02` §1.1: presentation не
 * имеет права импортировать `domain/*` напрямую (`dependency-cruiser`
 * `presentation-goes-through-application`), только через application. */
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
  /** 8 DI-инъекций, NestJS constructor injection резолвит по позиции (C5 недостижим без сокрытия
   * графа зависимостей за анонимной фабрикой) — тот же приём, что `VerifyOtpUseCase` (10 инъекций). */
  // eslint-disable-next-line max-params -- см. JSDoc выше
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
      // ОДНА транзакция (`tx`, ОДНО pg-соединение) на весь цикл — `Promise.all` здесь не параллелит
      // работу (та же БД-строка соединения), только рискует переупорядочить запись outbox (1:1
      // приём `inventory-facade.adapter.ts`, см. её JSDoc).
      for (const event of rating.pullDomainEvents()) {
        // eslint-disable-next-line no-await-in-loop -- см. комментарий выше
        await this.outbox.append(event, null, tx)
      }
      return rating.toSnapshot()
    })
  }

  /** «Шаги» 1-3 текста тикета (см. JSDoc файла) — вынесено из `execute()` ради `max-lines-per-function` (C1). */
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
