import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, HandoverOtpNotFoundError, NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
} from '../ports/delivery-unit-of-work.port.js'

export interface DepartToCustomerCommand {
  readonly assignmentId: string
  readonly userId: string
  readonly coldChainBagConfirmed?: boolean | undefined
}

export interface DepartToCustomerResult {
  readonly deliveryAssignmentId: string
}

// Один вызов переводит через ДВА перехода и закрепляет handoverOtpId заказа на назначении.
@Injectable()
export class DepartToCustomerUseCase {
  // eslint-disable-next-line max-params -- 5 DI-инъекций, явные @Inject
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(cmd: DepartToCustomerCommand): Promise<DepartToCustomerResult> {
    const courier = await this.couriers.findByUserId(cmd.userId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', userId: cmd.userId })
    }
    return this.uow.run(async (tx) => {
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
      if (orderContext.handoverOtpId === null) {
        throw new HandoverOtpNotFoundError({ orderId: assignment.orderId })
      }
      const now = this.clock.now()
      assignment.markPickedUpFromPharmacy(now)
      assignment.setHandoverOtp(orderContext.handoverOtpId)
      assignment.departToCustomer(cmd.coldChainBagConfirmed ?? false, now)
      await this.assignments.save(assignment, tx)
      return { deliveryAssignmentId: assignment.id }
    })
  }
}
