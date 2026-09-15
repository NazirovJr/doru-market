/**
 * `GetSupportTicketUseCase` (EP-14, DTJ-282) — `GET /api/v1/support-tickets/:id`: деталь тикета
 * + лента сообщений (`support_ticket_messages`, DTJ-278). Обоснованная достройка (см. «Риски»
 * DTJ-282, тот же комментарий, что `list-support-tickets.use-case.ts`).
 *
 * Авторизация — `SupportTicketsPolicy.canRead` (владелец ИЛИ сотрудник поддержки, DTJ-281).
 *
 * `SupportTicketDetailView`/`toSupportTicketDetailView` — переиспользуются
 * `add-support-ticket-message.use-case.ts`/`change-support-ticket-status.use-case.ts`: обе
 * мутации возвращают ТУ ЖЕ форму (ticket + messages), чтобы клиент (DTJ-283/284) обновлял
 * состояние прямо из ответа мутации, без второго `GET` сразу после записи.
 */
import { ForbiddenError } from '@dorutj/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { TicketNotFoundError, type SupportTicket, type SupportTicketMessage } from '../../domain/index.js'
import {
  SUPPORT_TICKETS_REPOSITORY,
  type SupportTicketsRepositoryPort,
} from '../ports/support-tickets-repository.port.js'
import { SupportTicketsPolicy, type SupportTicketsPolicyActor } from '../support-tickets.policy.js'
import { toSupportTicketListItem, type SupportTicketListItem } from './list-support-tickets.use-case.js'

export interface GetSupportTicketCommand {
  readonly ticketId: string
  readonly actor: SupportTicketsPolicyActor
}

/** Плоская проекция `SupportTicketMessage` (application-слой) — см. JSDoc `list-support-tickets.use-case.ts` про границу presentation/domain. */
export interface SupportTicketMessageView {
  readonly id: string
  readonly ticketId: string
  readonly authorUserId: string | null
  readonly authorRole: SupportTicketMessage['authorRole']
  readonly body: string
  readonly createdAt: Date
}

export interface SupportTicketDetailView extends SupportTicketListItem {
  readonly messages: readonly SupportTicketMessageView[]
}

@Injectable()
export class GetSupportTicketUseCase {
  public constructor(@Inject(SUPPORT_TICKETS_REPOSITORY) private readonly repository: SupportTicketsRepositoryPort) {}

  public async execute(command: GetSupportTicketCommand): Promise<SupportTicketDetailView> {
    const ticket = await this.repository.findById(command.ticketId)
    if (ticket === null) {
      throw new TicketNotFoundError(command.ticketId)
    }
    if (!SupportTicketsPolicy.canRead(command.actor, ticket)) {
      throw new ForbiddenError('Actor is not the ticket owner and not support staff', { ticketId: ticket.id })
    }
    const messages = await this.repository.listMessagesByTicketId(ticket.id)
    return toSupportTicketDetailView(ticket, messages)
  }
}

export function toSupportTicketDetailView(
  ticket: SupportTicket,
  messages: readonly SupportTicketMessage[],
): SupportTicketDetailView {
  return { ...toSupportTicketListItem(ticket), messages: messages.map(toMessageView) }
}

function toMessageView(message: SupportTicketMessage): SupportTicketMessageView {
  return {
    id: message.id,
    ticketId: message.ticketId,
    authorUserId: message.authorUserId,
    authorRole: message.authorRole,
    body: message.body,
    createdAt: message.createdAt,
  }
}
