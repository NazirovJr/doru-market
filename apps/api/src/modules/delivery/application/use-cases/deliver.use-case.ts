import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, HandoverOtpNotFoundError, NotFoundError } from '@dorutj/contracts'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import type { DeliveryDomainEvent } from '../../domain/delivery-domain-event.js'
import type { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { Courier } from '../../domain/courier.entity.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrderContext, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
} from '../ports/delivery-unit-of-work.port.js'
import {
  COURIER_EARNINGS_REPOSITORY,
  type CourierEarningsRepositoryPort,
} from '../ports/courier-earnings.repository.port.js'

const CASH_PAYMENT_METHOD = 'cash_courier'

export interface DeliverCommand {
  readonly assignmentId: string
  readonly userId: string
  readonly otpCode: string
  readonly proofPhotoUrl?: string | undefined
}

export interface DeliverResult {
  readonly deliveryAssignmentId: string
}

@Injectable()
export class DeliverUseCase {
  // eslint-disable-next-line max-params -- 7 DI-инъекций, явные @Inject
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(COURIER_EARNINGS_REPOSITORY) private readonly earnings: CourierEarningsRepositoryPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  public async execute(cmd: DeliverCommand): Promise<DeliverResult> {
    const courier = await this.couriers.findByUserId(cmd.userId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', userId: cmd.userId })
    }
    const assignment = await this.assignments.findById(cmd.assignmentId)
    if (assignment === null) {
      throw new NotFoundError({ resource: 'delivery_assignment', assignmentId: cmd.assignmentId })
    }
    if (assignment.courierId !== courier.id) {
      throw new ForbiddenError('Delivery assignment does not belong to this courier', { assignmentId: cmd.assignmentId })
    }
    if (assignment.handoverOtpId === null) {
      throw new HandoverOtpNotFoundError({ deliveryAssignmentId: assignment.id })
    }
    const orderContext = await this.orders.getDeliveryContext(assignment.orderId)
    if (orderContext === null) {
      throw new NotFoundError({ resource: 'order', orderId: assignment.orderId })
    }

    const now = this.clock.now()
    await this.orders.verifyHandoverOtp({ orderId: assignment.orderId, tenantId: orderContext.tenantId, candidateCode: cmd.otpCode, now })

    return this.persistDelivery({ assignment, courier, orderContext, now, proofPhotoUrl: cmd.proofPhotoUrl ?? null })
  }

  private async persistDelivery(input: {
    readonly assignment: DeliveryAssignment
    readonly courier: Courier
    readonly orderContext: DeliveryOrderContext
    readonly now: Date
    readonly proofPhotoUrl: string | null
  }): Promise<DeliverResult> {
    const { assignment, courier, orderContext, now, proofPhotoUrl } = input
    await this.uow.run(async (tx) => {
      const isCashOnDelivery = orderContext.paymentMethod === CASH_PAYMENT_METHOD
      assignment.markDelivered(now, isCashOnDelivery, proofPhotoUrl) // CashAmountMismatchError (TC-DELIV-012), ForbiddenTransitionError
      await this.assignments.save(assignment, tx)

      const event: DeliveryDomainEvent = {
        type: 'OrderDeliveredEvent',
        deliveryAssignmentId: assignment.id,
        orderId: assignment.orderId,
        courierId: courier.id,
        deliveredAt: now,
      }
      await this.outbox.append(event, orderContext.tenantId, tx)

      if (courier.chainId === null) {
        await this.earnings.create(
          {
            id: this.ids.next(),
            courierId: courier.id,
            deliveryAssignmentId: assignment.id,
            amountDiram: orderContext.deliveryFeeDiram,
            idempotencyKey: assignment.id,
          },
          tx,
        )
      }
    })
    await this.orders.markOrderDelivered({ orderId: assignment.orderId, tenantId: orderContext.tenantId, now })
    return { deliveryAssignmentId: assignment.id }
  }
}
