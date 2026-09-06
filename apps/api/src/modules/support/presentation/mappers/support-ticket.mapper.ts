/**
 * `support-ticket.mapper.ts` (EP-14, DTJ-282) — `SupportTicket*` (application-слой, `SupportTicketListItem`/
 * `SupportTicketDetailView`/`SupportTicketMessageView`) → `SupportTicketDto`/`SupportTicketMessageDto`
 * (`@dorutj/contracts`). Единственный файл presentation-слоя, знающий форму wire-DTO — контроллер
 * его не собирает вручную (`02` §5, «ни один контроллер не возвращает сущность БД напрямую»,
 * DTJ-282 DoD).
 *
 * `messages` по умолчанию `[]` — вызывается БЕЗ второго аргумента для списка (`GET /`,
 * `POST /:id/status`, см. JSDoc `SupportTicketDto.messages`), С аргументом — для детали
 * (`GET /:id`, `POST /:id/messages`, обе возвращают `SupportTicketDetailView`, чьё поле
 * `messages` передаётся сюда напрямую).
 */
import type { SupportTicketDto, SupportTicketMessageDto } from '@dorutj/contracts'
import type { SupportTicketListItem } from '@/modules/support/application/use-cases/list-support-tickets.use-case.js'
import type { SupportTicketMessageView } from '@/modules/support/application/use-cases/get-support-ticket.use-case.js'

export function toSupportTicketDto(
  ticket: SupportTicketListItem,
  messages: readonly SupportTicketMessageView[] = [],
): SupportTicketDto {
  return {
    id: ticket.id,
    tenantId: ticket.tenantId,
    orderId: ticket.orderId,
    channel: ticket.channel,
    category: ticket.category,
    isEscrowBlocking: false,
    status: ticket.status,
    priority: ticket.priority,
    createdBy: ticket.createdBy,
    description: ticket.description,
    firstResponseDueAt: ticket.firstResponseDueAt?.toISOString() ?? null,
    firstRespondedAt: ticket.firstRespondedAt?.toISOString() ?? null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    messages: messages.map(toSupportTicketMessageDto),
  }
}

function toSupportTicketMessageDto(message: SupportTicketMessageView): SupportTicketMessageDto {
  return {
    id: message.id,
    ticketId: message.ticketId,
    authorUserId: message.authorUserId,
    authorRole: message.authorRole,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  }
}
