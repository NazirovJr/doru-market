/**
 * `DeliveryAssignmentRepositoryPort` (EP-13, DTJ-314).
 *
 * `TERMINAL_DELIVERY_ASSIGNMENT_STATUSES`/`isNonTerminalAssignmentStatus` — источник истины для
 * «активное назначение» (SRS-DOM-036, 1:1 частичный уникальный индекс `ux_delivery_assignment_
 * one_active`, `db/schema/delivery-assignments.ts`): `status NOT IN ('delivered',
 * 'delivery_failed')`. Экспортированы отсюда (не продублированы) — DTJ-320
 * (`EndCourierShiftUseCase`, ACTIVE_ASSIGNMENT_BLOCKS_SHIFT_END) переиспользует ТУ ЖЕ константу
 * для курьер-скоуп-запроса `courier_id = X AND status NOT IN (...)`: набор строк идентичен
 * `status IN ('assigned'..'en_route_to_customer')` из текста SRS-DELIV-029, т.к. `courier_id`
 * ненулевой ⇒ `status != 'unassigned'` структурно (см. JSDoc use case'а).
 */
import type { DeliveryAssignmentStatus } from '@dorutj/contracts'
import type { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const DELIVERY_ASSIGNMENT_REPOSITORY = Symbol.for('@dorutj/delivery/delivery-assignment-repository')

/** SRS-DOM-036 — статусы, терминирующие назначение (см. JSDoc файла). */
export const TERMINAL_DELIVERY_ASSIGNMENT_STATUSES: readonly DeliveryAssignmentStatus[] = [
  'delivered',
  'delivery_failed',
]

export function isNonTerminalAssignmentStatus(status: DeliveryAssignmentStatus): boolean {
  return !TERMINAL_DELIVERY_ASSIGNMENT_STATUSES.includes(status)
}

export interface DeliveryAssignmentRepositoryPort {
  findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryAssignment | null>
  /** Нетерминальное назначение этого заказа (SRS-DOM-036), либо `null`. */
  findActiveByOrderId(orderId: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryAssignment | null>
  /**
   * Назначение этого заказа НЕЗАВИСИМО от статуса (ДОБАВЛЕНО DTJ-321) — `findActiveByOrderId`
   * непригоден для `SubmitCourierRatingUseCase`: оценка доступна только для `order.status=
   * 'delivered'` (SRS-DELIV-032), к этому моменту назначение УЖЕ терминально
   * (`status='delivered'`) и структурно не проходит фильтр «нетерминальный» — нужен доступ к
   * courierId доставленного заказа именно ПОСЛЕ терминации.
   */
  findByOrderId(orderId: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryAssignment | null>
  /** Есть ли у курьера физически незавершённое назначение (SRS-DELIV-029, блокирует end-shift). */
  hasActiveAssignmentForCourier(courierId: string, tx?: DeliveryUnitOfWorkTx): Promise<boolean>
  save(assignment: DeliveryAssignment, tx?: DeliveryUnitOfWorkTx): Promise<void>
}
