/**
 * Публичные контракты модуля `support` (EP-14, DTJ-270/282) — DTO presentation-слоя
 * (`support-tickets.controller.ts`, DTJ-282).
 *
 * `SupportTicketChannel`/`SupportTicketCategory`/`SupportTicketStatus` — 1:1 с БД
 * (`support_ticket_channel`/`support_ticket_category`/`support_ticket_status` enum'ы, уже
 * созданы миграцией `0034_support_tickets_audit_log.sql`, DTJ-247 — `db/schema/enums.schema.ts`
 * несёт их первое типизированное Drizzle-определение, см. JSDoc `db/schema/support.ts`).
 */
import type { UserRole } from './permissions.js'

/** 1:1 с enum `support_ticket_channel`. */
export const SUPPORT_TICKET_CHANNEL_VALUES = ['in_app', 'telegram_bot', 'phone', 'system_auto'] as const
export type SupportTicketChannel = (typeof SUPPORT_TICKET_CHANNEL_VALUES)[number]

/** 1:1 с enum `support_ticket_category`. */
export const SUPPORT_TICKET_CATEGORY_VALUES = [
  'order_not_received',
  'payment_issue',
  'order_item_damaged_or_expired',
  'order_quality_defect',
  'courier_conduct',
  'other',
] as const
export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORY_VALUES)[number]

/** 1:1 с enum `support_ticket_status`. */
export const SUPPORT_TICKET_STATUS_VALUES = ['open', 'in_progress', 'resolved', 'closed'] as const
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUS_VALUES)[number]

/**
 * `SupportTicketMessageDto` (DTJ-282) — одна запись переписки `support_ticket_messages`
 * (DTJ-278) для presentation-слоя. 1:1 с `SupportTicketMessageSnapshot` (domain), но даты — ISO
 * `string` (транспортный формат, не `Date`).
 */
export interface SupportTicketMessageDto {
  readonly id: string
  readonly ticketId: string
  readonly authorUserId: string | null
  readonly authorRole: UserRole
  readonly body: string
  readonly createdAt: string
}

/**
 * `SupportTicketDto` (DTJ-270, наполнено DTJ-282) — DTO обращения для presentation-слоя. Поля
 * соответствуют `support_tickets` (`11-database-schema.md` Группа F + SLA-расширение DTJ-278).
 *
 * `messages` — ВСЕГДА `[]` в ответе `GET /api/v1/support-tickets` (список): переписка целиком
 * запрашивается только для одного тикета за раз (`GET /:id`/`POST /:id/messages`/
 * `POST /:id/status`, см. `support-ticket.mapper.ts`) — список не тянет N+1 запросов переписки
 * ради поля, которое очередь тикетов (DTJ-283) не показывает.
 */
export interface SupportTicketDto {
  readonly id: string
  readonly tenantId: string
  readonly orderId: string | null
  readonly channel: SupportTicketChannel
  readonly category: SupportTicketCategory
  /**
   * АРХИТЕКТУРНАЯ гарантия SRS-ADM-053 (см. JSDoc `SupportTicket.isEscrowBlocking`, DTJ-278) —
   * литерал `false`, не `boolean`: в R1 домен физически не может произвести иное значение, тип
   * делает это видимым на границе API, не только в комментарии. Поле НЕ скрыто (сохранено ради
   * совместимости с будущим R3 `disputes_workflow_enabled`, DTJ-282 DoD).
   */
  readonly isEscrowBlocking: false
  readonly status: SupportTicketStatus
  readonly priority: number
  readonly createdBy: string | null
  readonly description: string | null
  readonly firstResponseDueAt: string | null
  readonly firstRespondedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly messages: readonly SupportTicketMessageDto[]
}
