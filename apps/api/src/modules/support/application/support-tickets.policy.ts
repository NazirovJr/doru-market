/**
 * `SupportTicketsPolicy` (EP-14, DTJ-281, SRS-API-038) — `application/` (тот же слой, что уже
 * установленные `OrderPolicy`/`StaffAccountPolicy`, `02` §3.4: policy — в application, guard —
 * только грубая роль presentation). Переиспользуется DTJ-282
 * (`presentation/support-tickets.controller.ts`) для авторизации `GET /:id`/`POST /:id/messages`/
 * `POST /:id/status` — единая точка правил, не разрозненные проверки внутри контроллера.
 *
 * Чистые функции без side-effects, `boolean` — ошибку с `ErrorCode` (`403 FORBIDDEN`) формирует
 * вызывающий код (тот же приём, что `OrderPolicy.canCancel`).
 */
import type { UserRole } from '@dorutj/contracts'
import type { SupportTicket } from './../domain/index.js'

export interface SupportTicketsPolicyActor {
  readonly role: UserRole
  readonly userId: string
}

const STAFF_ROLES: ReadonlySet<UserRole> = new Set(['support_agent', 'super_admin'])

function isStaff(role: UserRole): boolean {
  return STAFF_ROLES.has(role)
}

export const SupportTicketsPolicy = {
  /** Владелец тикета (`createdBy`) либо любой сотрудник поддержки. */
  canRead(actor: SupportTicketsPolicyActor, ticket: SupportTicket): boolean {
    if (isStaff(actor.role)) return true
    return actor.userId === ticket.createdBy
  },

  /**
   * ТОЛЬКО сотрудник поддержки — официальный ответ агента. Владелец тикета допускается на
   * `POST /:id/messages` ОТДЕЛЬНОЙ веткой в контроллере (`ticket.createdBy === actor.userId`,
   * DTJ-282 «Что сделать» п.1: «владелец ИЛИ support_agent/super_admin» — два разных условия,
   * не одно), не через этот метод.
   */
  canRespond(actor: SupportTicketsPolicyActor): boolean {
    return isStaff(actor.role)
  },

  canResolve(actor: SupportTicketsPolicyActor): boolean {
    return isStaff(actor.role)
  },
}
