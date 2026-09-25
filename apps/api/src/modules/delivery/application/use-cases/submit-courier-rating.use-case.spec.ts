import { describe, expect, it, vi } from 'vitest'
import { BusinessRuleViolationError, ForbiddenError, NotFoundError, RatingAlreadySubmittedError } from '@dorutj/contracts'
import type { Clock, IdGenerator } from '@/shared-kernel/index.js'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { CourierRatingRepositoryPort } from '../ports/courier-rating.repository.port.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { DeliveryOrdersPort, OrderRatingContext } from '../ports/delivery-orders.port.js'
import type { DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { SubmitCourierRatingUseCase, type SubmitCourierRatingInput } from './submit-courier-rating.use-case.js'

const NOW = new Date('2026-09-06T10:00:00.000Z')
const TENANT_ID = 'tenant-1'
const CUSTOMER_ID = 'customer-1'
const ORDER_ID = 'order-1'
const COURIER_ID = 'courier-1'
const NEW_RATING_ID = 'rating-new'

function makeCourier(overrides: { ratingAvg?: number; ratingCount?: number } = {}): Courier {
  const courier = Courier.create({
    id: COURIER_ID,
    userId: 'user-1',
    chainId: null,
    taxStatus: 'individual_patent',
    vehicleType: 'car',
    now: NOW,
  })
  if (overrides.ratingAvg === undefined && overrides.ratingCount === undefined) {
    return courier
  }
  return Courier.restore({
    ...courier.props,
    ratingAvg: overrides.ratingAvg ?? courier.ratingAvg,
    ratingCount: overrides.ratingCount ?? courier.ratingCount,
  })
}

function makeDeliveredAssignment(courierId: string | null = COURIER_ID): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: 'assignment-1',
    orderId: ORDER_ID,
    courierId,
    status: 'delivered',
    landmarkText: null,
    handoverOtpId: null,
    cashCollectedDiram: null,
    cashChangeDiram: null,
    reassignReason: null,
    reassignedBy: null,
    assignedAt: NOW,
    pickedUpFromPharmacyAt: NOW,
    deliveredAt: NOW,
    failedReason: null,
    createdAt: NOW,
    requiresColdChain: false,
    coldChainBagConfirmed: false,
    coldChainBagConfirmedAt: null,
    contactAttemptsCount: 0,
    lastContactAttemptAt: null,
    distanceMeters: null,
  }
  return DeliveryAssignment.restore(snapshot)
}

interface Harness {
  readonly useCase: SubmitCourierRatingUseCase
  readonly ratingsSave: ReturnType<typeof vi.fn>
  readonly couriersSave: ReturnType<typeof vi.fn>
  readonly outboxAppend: ReturnType<typeof vi.fn>
}

function makeUseCase(params: {
  readonly order: OrderRatingContext | null
  readonly assignment?: DeliveryAssignment | null
  readonly courier?: Courier | null
  readonly alreadyRated?: boolean
}): Harness {
  const ratingsSave = vi.fn().mockResolvedValue(undefined)
  const couriersSave = vi.fn().mockResolvedValue(undefined)
  const outboxAppend = vi.fn().mockResolvedValue(undefined)
  const orders: DeliveryOrdersPort = {
    getOrderForRating: vi.fn().mockResolvedValue(params.order),
    getDeliveryContext: vi.fn().mockResolvedValue(null),
  }
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByOrderId: vi.fn().mockResolvedValue(params.assignment === undefined ? makeDeliveredAssignment() : params.assignment),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const ratings: CourierRatingRepositoryPort = {
    existsByOrderId: vi.fn().mockResolvedValue(params.alreadyRated ?? false),
    save: ratingsSave,
  }
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.courier === undefined ? makeCourier() : params.courier),
    findByUserId: vi.fn().mockResolvedValue(null),
    save: couriersSave,
  }
  const outbox: DeliveryOutboxPort = { append: outboxAppend }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const ids: IdGenerator = { next: vi.fn(() => NEW_RATING_ID) }
  const clock: Clock = { now: () => NOW }
  return {
    useCase: new SubmitCourierRatingUseCase(orders, assignments, ratings, couriers, outbox, uow, ids, clock),
    ratingsSave,
    couriersSave,
    outboxAppend,
  }
}

function baseInput(overrides: Partial<SubmitCourierRatingInput> = {}): SubmitCourierRatingInput {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    orderId: ORDER_ID,
    rating: 5,
    comment: null,
    ...overrides,
  }
}

describe('SubmitCourierRatingUseCase', () => {
  it('TC-DELIV-032: delivered + не оценено -> сохраняет оценку, couriers.rating_count+=1, rating_avg пересчитан, публикует CourierRatedEvent', async () => {
    const { useCase, ratingsSave, couriersSave, outboxAppend } = makeUseCase({
      order: { orderId: ORDER_ID, customerId: CUSTOMER_ID, status: 'delivered' },
      courier: makeCourier({ ratingAvg: 4, ratingCount: 1 }),
    })

    const snapshot = await useCase.execute(baseInput({ rating: 5 }))

    expect(snapshot.id).toBe(NEW_RATING_ID)
    expect(snapshot.courierId).toBe(COURIER_ID)
    expect(ratingsSave).toHaveBeenCalledTimes(1)
    expect(couriersSave).toHaveBeenCalledTimes(1)
    const savedCourier = couriersSave.mock.calls[0]?.[0] as Courier
    expect(savedCourier.ratingCount).toBe(2)
    expect(savedCourier.ratingAvg).toBe(4.5) // (4*1 + 5) / 2
    expect(outboxAppend).toHaveBeenCalledTimes(1)
    const [publishedEvent] = outboxAppend.mock.calls[0] as [unknown]
    expect(publishedEvent).toMatchObject({ type: 'CourierRatedEvent', orderId: ORDER_ID, courierId: COURIER_ID, rating: 5 })
  })

  it('первая оценка курьера (rating_count_before=0) -> rating_avg упрощается до rating (без деления на ноль)', async () => {
    const { useCase, couriersSave } = makeUseCase({
      order: { orderId: ORDER_ID, customerId: CUSTOMER_ID, status: 'delivered' },
      courier: makeCourier({ ratingAvg: 5, ratingCount: 0 }),
    })

    await useCase.execute(baseInput({ rating: 3 }))

    const savedCourier = couriersSave.mock.calls[0]?.[0] as Courier
    expect(savedCourier.ratingCount).toBe(1)
    expect(savedCourier.ratingAvg).toBe(3)
  })

  it('заказ не найден (чужой тенант/несуществующий) -> NotFoundError', async () => {
    const { useCase, ratingsSave } = makeUseCase({ order: null })

    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(NotFoundError)
    expect(ratingsSave).not.toHaveBeenCalled()
  })

  it('заказ принадлежит другому customer -> ForbiddenError, оценка не создаётся', async () => {
    const { useCase, ratingsSave } = makeUseCase({
      order: { orderId: ORDER_ID, customerId: 'someone-else', status: 'delivered' },
    })

    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ForbiddenError)
    expect(ratingsSave).not.toHaveBeenCalled()
  })

  it('order.status !== delivered -> BusinessRuleViolationError (422 по ERROR_HTTP_STATUS), оценка не создаётся', async () => {
    const { useCase, ratingsSave } = makeUseCase({
      order: { orderId: ORDER_ID, customerId: CUSTOMER_ID, status: 'en_route_to_customer' },
    })

    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(BusinessRuleViolationError)
    expect(ratingsSave).not.toHaveBeenCalled()
  })

  it('TC-DELIV-033: оценка уже существует для order_id -> 409 RatingAlreadySubmittedError, save не вызывается', async () => {
    const { useCase, ratingsSave, couriersSave } = makeUseCase({
      order: { orderId: ORDER_ID, customerId: CUSTOMER_ID, status: 'delivered' },
      alreadyRated: true,
    })

    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(RatingAlreadySubmittedError)
    expect(ratingsSave).not.toHaveBeenCalled()
    expect(couriersSave).not.toHaveBeenCalled()
  })

  it('назначение доставленного заказа не найдено (испорченные данные) -> NotFoundError, не 500 без объяснения', async () => {
    const { useCase } = makeUseCase({
      order: { orderId: ORDER_ID, customerId: CUSTOMER_ID, status: 'delivered' },
      assignment: null,
    })

    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(NotFoundError)
  })
})
