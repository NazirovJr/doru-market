/**
 * `SupportTicketsPolicy` (EP-14, DTJ-281, SRS-API-038) — `application/` (тот же слой, что уже
 * установленные `OrderPolicy`/`StaffAccountPolicy`, `02` §3.4: policy — в application, guard —
 * только грубая роль presentation). Переиспользуется DTJ-282
 * (`presentation/support-tickets.controller.ts`) для авторизации `GET /:id`/`POST /:id/messages`/
 * `POST /:id/status` — единая точка правил, не разрозненные проверки внутри контроллера.
 *
 * `actor.tenantId` — ДОБАВЛЕНО DTJ-282 (было отсутствовать в заготовке DTJ-281): без него
 * `canRespond`/`canResolve` пропускали ЛЮБОГО `support_agent`/`super_admin` к ЛЮБОМУ тикету
 * ЛЮБОГО тенанта (роль — единственное условие) — межтенантная утечка (ticket text «всё тикеты
 * СВОЕГО тенанта», DTJ-282 п.1/AC2). `findById` в `SupportTicketsRepositoryPort` не фильтрует по
 * тенанту (используется и `EscalateTicketPriorityUseCase`, где тенант заранее неизвестен) —
 * единственный рубеж для одиночного тикета (`GET /:id`/`.../messages`/`.../status`) — эта
 * политика, поэтому она обязана сверять `actor.tenantId === ticket.tenantId` САМА, не полагаясь
 * на репозиторий. Владелец (`createdBy`) тенант неявно совпадает (`users.tenant_id` фиксирован),
 * но сверяется явно — defense-in-depth, не расчёт на инвариант чужого модуля.
 *
 * Чистые функции без side-effects, `boolean` — ошибку с `ErrorCode` (`403 FORBIDDEN`) формирует
 * вызывающий код (тот же приём, что `OrderPolicy.canCancel`).
 */
import type { UserRole } from '@dorutj/contracts'
import type { SupportTicket } from '../domain/index.js'

export interface SupportTicketsPolicyActor {
  readonly role: UserRole
  readonly userId: string
  readonly tenantId: string
}

const STAFF_ROLES: ReadonlySet<UserRole> = new Set(['support_agent', 'super_admin'])

function isStaff(role: UserRole): boolean {
  return STAFF_ROLES.has(role)
}

function isSameTenant(actor: SupportTicketsPolicyActor, ticket: SupportTicket): boolean {
  return actor.tenantId === ticket.tenantId
}

export const SupportTicketsPolicy = {
  /** Владелец тикета (`createdBy`, СВОЙ тенант) либо сотрудник поддержки ЭТОГО ЖЕ тенанта. */
  canRead(actor: SupportTicketsPolicyActor, ticket: SupportTicket): boolean {
    if (actor.userId === ticket.createdBy && isSameTenant(actor, ticket)) return true
    return isStaff(actor.role) && isSameTenant(actor, ticket)
  },

  /**
   * ТОЛЬКО сотрудник поддержки СВОЕГО тенанта — официальный ответ агента. Владелец тикета
   * допускается на `POST /:id/messages` ОТДЕЛЬНОЙ веткой в контроллере
   * (`ticket.createdBy === actor.userId`, DTJ-282 «Что сделать» п.1: «владелец ИЛИ
   * support_agent/super_admin» — два разных условия, не одно), не через этот метод.
   */
  canRespond(actor: SupportTicketsPolicyActor, ticket: SupportTicket): boolean {
    return isStaff(actor.role) && isSameTenant(actor, ticket)
  },

  canResolve(actor: SupportTicketsPolicyActor, ticket: SupportTicket): boolean {
    return isStaff(actor.role) && isSameTenant(actor, ticket)
  },

  /**
   * ДОБАВЛЕНО DTJ-282 — `GET /api/v1/support-tickets` (`ListSupportTicketsUseCase`): сотрудник
   * поддержки видит ВСЕ тикеты СВОЕГО тенанта, любая другая роль — только тикеты, где сама
   * является `createdBy` (тот же STAFF_ROLES-набор, что `canRespond`/`canResolve`). Без `ticket`-
   * параметра — тенант-скоуп здесь применяется на уровне SQL-фильтра `list()`
   * (`tenantId: actor.tenantId` ВСЕГДА, независимо от роли, см. `ListSupportTicketsUseCase`),
   * этот метод решает только «свои/все» ВНУТРИ уже гарантированного тенанта.
   */
  canListAll(actor: SupportTicketsPolicyActor): boolean {
    return isStaff(actor.role)
  },
}
