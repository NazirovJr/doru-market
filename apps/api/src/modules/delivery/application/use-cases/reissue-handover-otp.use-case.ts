// OrdersFacade.reissueHandoverOtp переключает orders.handover_otp_id; здесь — только синхронизация копии.
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  isNonTerminalAssignmentStatus,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import {
  DELIVERY_ORDERS_PORT,
  type DeliveryOrdersPort,
  type ReissueHandoverOtpActor,
} from '../ports/delivery-orders.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
} from '../ports/delivery-unit-of-work.port.js'

export interface ReissueHandoverOtpCommand {
  readonly assignmentId: string
  readonly actor: ReissueHandoverOtpActor
}

export interface ReissueHandoverOtpResult {
  readonly deliveryAssignmentId: string
  readonly code: string
  readonly expiresAt: Date
}

@Injectable()
export class ReissueHandoverOtpUseCase {
  public constructor(
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
  ) {}

  public async execute(cmd: ReissueHandoverOtpCommand): Promise<ReissueHandoverOtpResult> {
    const assignment = await this.assignments.findById(cmd.assignmentId)
    if (assignment === null || !isNonTerminalAssignmentStatus(assignment.status) || assignment.handoverOtpId === null) {
      throw new NotFoundError({ resource: 'delivery_assignment_handover_otp', assignmentId: cmd.assignmentId })
    }
    const issued = await this.orders.reissueHandoverOtp({ orderId: assignment.orderId, actor: cmd.actor })
    return this.uow.run(async (tx) => {
      assignment.setHandoverOtp(issued.handoverOtpId) // синхронизация локальной копии — orders уже переключил свою.
      await this.assignments.save(assignment, tx)
      return { deliveryAssignmentId: assignment.id, code: issued.code, expiresAt: issued.expiresAt }
    })
  }
}
