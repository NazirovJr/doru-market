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
}
