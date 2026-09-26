/** `GET /delivery-assignments/mine?status=active|history` (тикет DTJ-317 п.1) — ОБЯЗАТЕЛЕН для
 *  REST catch-up курьера после WS-реконнекта (клиент вызывает ПЕРВЫМ делом при восстановлении). */
import { Inject, Injectable } from '@nestjs/common'
import { DELIVERY_ASSIGNMENT_STATUS_VALUES, NotFoundError, type DeliveryAssignmentStatus } from '@dorutj/contracts'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  TERMINAL_DELIVERY_ASSIGNMENT_STATUSES,
  isNonTerminalAssignmentStatus,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'

const NON_TERMINAL_STATUSES = DELIVERY_ASSIGNMENT_STATUS_VALUES.filter(isNonTerminalAssignmentStatus)

export type MineAssignmentsScope = 'active' | 'history'

export interface GetMineDeliveryAssignmentsCommand {
  readonly userId: string
  readonly scope: MineAssignmentsScope
  readonly limit: number
  readonly cursor: { readonly createdAt: Date; readonly id: string } | null
}

export interface MineAssignmentView {
  readonly id: string
  readonly orderId: string
  readonly status: DeliveryAssignmentStatus
  readonly createdAt: Date
  readonly assignedAt: Date | null
  readonly deliveredAt: Date | null
}

export interface GetMineDeliveryAssignmentsResult {
  readonly items: readonly MineAssignmentView[]
  readonly nextCursor: { readonly createdAt: Date; readonly id: string } | null
  readonly hasMore: boolean
}

@Injectable()
export class GetMineDeliveryAssignmentsUseCase {
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
  ) {}

  public async execute(cmd: GetMineDeliveryAssignmentsCommand): Promise<GetMineDeliveryAssignmentsResult> {
    const courier = await this.couriers.findByUserId(cmd.userId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', userId: cmd.userId })
    }
    const statuses = cmd.scope === 'active' ? NON_TERMINAL_STATUSES : TERMINAL_DELIVERY_ASSIGNMENT_STATUSES
    const raw = await this.assignments.findByCourierAndStatuses({
      courierId: courier.id,
      statuses,
      limit: cmd.limit + 1,
      cursor: cmd.cursor,
    })
    const hasMore = raw.length > cmd.limit
    const page = hasMore ? raw.slice(0, cmd.limit) : raw
    const last = page[page.length - 1]
    return {
      items: page.map(toView),
      nextCursor: hasMore && last !== undefined ? { createdAt: last.toSnapshot().createdAt, id: last.id } : null,
      hasMore,
    }
  }
}

function toView(assignment: DeliveryAssignment): MineAssignmentView {
  const snapshot = assignment.toSnapshot()
  return {
    id: assignment.id,
    orderId: assignment.orderId,
    status: assignment.status,
    createdAt: snapshot.createdAt,
    assignedAt: snapshot.assignedAt,
    deliveredAt: snapshot.deliveredAt,
  }
}
