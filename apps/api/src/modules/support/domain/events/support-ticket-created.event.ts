/**
 * `SupportTicketCreatedEvent` (EP-14, DTJ-279, SRS-DOM-151). Публикуется через `outbox` в ТОЙ
 * ЖЕ транзакции, что `INSERT support_tickets` (`CreateSupportTicketUseCase`).
 *
 * Потребители: `NotificationsFacade` (EP-16) — матрица SRS-ADM-052 в этой версии НЕ содержит
 * строки конкретно для этого события (только для `SlaBreachedEvent`) — намеренно НЕ добавляем
 * уведомление самовольно за пределами описанного контракта (риск DTJ-279 п.1), это решение
 * остаётся за EP-16.
 *
 * `priority: 0` — литерал (не `number`): тикет только что создан, `SupportTicket.open()`
 * (DTJ-278) всегда стартует с `priority=0`, эскалация — отдельное событие/джоба (DTJ-280, вне
 * периметра).
 */
import type { SupportTicketCategory, SupportTicketChannel } from '@dorutj/contracts'

export interface SupportTicketCreatedEvent {
  readonly type: 'SupportTicketCreatedEvent'
  readonly ticketId: string
  readonly tenantId: string
  readonly orderId: string | null
  readonly category: SupportTicketCategory
  readonly channel: SupportTicketChannel
  readonly priority: 0
}
