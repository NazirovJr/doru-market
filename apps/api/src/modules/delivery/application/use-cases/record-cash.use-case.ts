import { Inject, Injectable } from '@nestjs/common'
import { BusinessRuleViolationError, ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { Courier } from '../../domain/courier.entity.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import {
  COURIER_SHIFT_REPOSITORY,
  type CourierShiftRepositoryPort,
} from '../ports/courier-shift.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
  type DeliveryUnitOfWorkTx,
} from '../ports/delivery-unit-of-work.port.js'

const CASH_PAYMENT_METHOD = 'cash_courier'

export interface RecordCashCommand {
  readonly assignmentId: string
  readonly userId: string
  readonly collectedDiram: number
  readonly changeDiram: number
}

export interface RecordCashResult {
  readonly deliveryAssignmentId: string
  readonly cashCollectedDiram: number
  readonly cashChangeDiram: number
}

// Idempotency-Key обязателен на транспортном уровне (@Idempotent() контроллера), не здесь.
@Injectable()
export class RecordCashUseCase {
  // eslint-disable-next-line max-params -- 6 DI-инъекций, явные @Inject
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(COURIER_SHIFT_REPOSITORY) private readonly shifts: CourierShiftRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
  ) {}

  public async execute(cmd: RecordCashCommand): Promise<RecordCashResult> {
    const courier = await this.couriers.findByUserId(cmd.userId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', userId: cmd.userId })
    }
    return this.uow.run((tx) => this.applyAndPersist(cmd, courier, tx))
  }

  private async applyAndPersist(cmd: RecordCashCommand, courier: Courier, tx: DeliveryUnitOfWorkTx): Promise<RecordCashResult> {
    const assignment = await this.assignments.findById(cmd.assignmentId, tx)
    if (assignment === null) {
      throw new NotFoundError({ resource: 'delivery_assignment', assignmentId: cmd.assignmentId })
    }
    if (assignment.courierId !== courier.id) {
      throw new ForbiddenError('Delivery assignment does not belong to this courier', { assignmentId: cmd.assignmentId })
    }
    const orderContext = await this.orders.getDeliveryContext(assignment.orderId)
    if (orderContext === null) {
      throw new NotFoundError({ resource: 'order', orderId: assignment.orderId })
    }
    if (orderContext.paymentMethod !== CASH_PAYMENT_METHOD) {
      throw new BusinessRuleViolationError('record-cash is only allowed for cash_courier orders', {
        assignmentId: cmd.assignmentId,
        paymentMethod: orderContext.paymentMethod,
      })
    }
    const collected = Money.fromDiram(BigInt(cmd.collectedDiram))
    const change = Money.fromDiram(BigInt(cmd.changeDiram))
    assignment.recordCash(collected, change, Money.fromDiram(orderContext.totalAmountDiram))
    const activeShift = await this.shifts.findActiveByCourierId(courier.id, tx)
    if (activeShift === null) {
      throw new NotFoundError({ resource: 'courier_shift', courierId: courier.id })
    }
    activeShift.recordCashCollected(collected)
    const updatedCourier = courier.addCashOnHand(collected)
    await this.assignments.save(assignment, tx)
    await this.shifts.save(activeShift, tx)
    await this.couriers.save(updatedCourier, tx)
    return { deliveryAssignmentId: assignment.id, cashCollectedDiram: Number(collected.diram), cashChangeDiram: Number(change.diram) }
  }
}
