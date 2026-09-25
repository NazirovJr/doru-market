import type { DeliveryAssignmentStatus } from '@dorutj/contracts'
import type { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const DELIVERY_ASSIGNMENT_REPOSITORY = Symbol.for('@dorutj/delivery/delivery-assignment-repository')

export const TERMINAL_DELIVERY_ASSIGNMENT_STATUSES: readonly DeliveryAssignmentStatus[] = [
  'delivered',
  'delivery_failed',
]

export function isNonTerminalAssignmentStatus(status: DeliveryAssignmentStatus): boolean {
  return !TERMINAL_DELIVERY_ASSIGNMENT_STATUSES.includes(status)
}

export interface DeliveryAssignmentRepositoryPort {
  findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryAssignment | null>
  findActiveByOrderId(orderId: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryAssignment | null>
  // в отличие от findActiveByOrderId, не фильтрует по статусу — нужен доступ к courierId уже доставленного заказа (рейтинг)
  findByOrderId(orderId: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryAssignment | null>
  hasActiveAssignmentForCourier(courierId: string, tx?: DeliveryUnitOfWorkTx): Promise<boolean>
  save(assignment: DeliveryAssignment, tx?: DeliveryUnitOfWorkTx): Promise<void>
  // Условный UPDATE (status='unassigned' AND NOT EXISTS активного оффера) — единственная точка записи claim, не save().
  claimUnassigned(input: AssignUnassignedInput, tx: DeliveryUnitOfWorkTx): Promise<boolean>
  // Тот же условный UPDATE, но без условия «нет оффера» — диспетчер обходит очередь предложений целиком.
  assignManual(input: AssignUnassignedInput, tx: DeliveryUnitOfWorkTx): Promise<boolean>
  findUnassignedPool(tx?: DeliveryUnitOfWorkTx): Promise<readonly DeliveryAssignment[]>
  findByStatuses(
    input: FindByStatusesInput,
    tx?: DeliveryUnitOfWorkTx,
  ): Promise<readonly DeliveryAssignment[]>
}

export interface FindByStatusesInput {
  readonly statuses: readonly DeliveryAssignmentStatus[]
  readonly limit: number
  readonly cursor: { readonly createdAt: Date; readonly id: string } | null
}

export interface AssignUnassignedInput {
  readonly id: string
  readonly courierId: string
  readonly now: Date
}
