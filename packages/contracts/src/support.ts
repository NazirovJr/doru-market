/**
 * Публичные контракты модуля `support` (EP-14, DTJ-270) — заготовки DTO, наполняются по мере
 * готовности `DTJ-278` (домен `SupportTicket`) / `DTJ-279` (`CreateSupportTicketUseCase`,
 * вне периметра этой волны за пределами DTJ-279).
 *
 * `SupportTicketChannel`/`SupportTicketCategory`/`SupportTicketStatus` — 1:1 с БД
 * (`support_ticket_channel`/`support_ticket_category`/`support_ticket_status` enum'ы, уже
 * созданы миграцией `0034_support_tickets_audit_log.sql`, DTJ-247 — `db/schema/enums.schema.ts`
 * несёт их первое типизированное Drizzle-определение, см. JSDoc `db/schema/support.ts`).
 */

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
 * `SupportTicketDto` (заготовка, DTJ-270) — DTO обращения для presentation-слоя. Поля
 * соответствуют `support_tickets` (`11-database-schema.md` Группа F + SLA-расширение DTJ-278),
 * наполняется/уточняется DTJ-278/279/281 (вне периметра этой волны за пределами DTJ-278/279).
 */
export interface SupportTicketDto {
  readonly id: string
  readonly tenantId: string
  readonly orderId: string | null
  readonly channel: SupportTicketChannel
  readonly category: SupportTicketCategory
  readonly isEscrowBlocking: boolean
  readonly status: SupportTicketStatus
  readonly createdBy: string | null
  readonly description: string | null
  readonly createdAt: string
  readonly updatedAt: string
}
