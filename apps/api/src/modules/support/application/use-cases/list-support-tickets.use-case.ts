/**
 * `ListSupportTicketsUseCase` (EP-14, DTJ-282) — `GET /api/v1/support-tickets`.
 *
 * Обоснованная достройка (не буквальный SRS, см. «Риски» DTJ-282): единственный явно
 * специфицированный эндпоинт модуля — создание (`SRS-ADM-074`). Скоуп видимости —
 * `SupportTicketsPolicy.canListAll` (единая точка правил, DTJ-281): сотрудник поддержки
 * (`support_agent`/`super_admin`) видит ВСЕ тикеты своего тенанта, любая другая роль — только
 * тикеты, созданные ЕЮ САМОЙ (`createdBy = actor.userId`, принудительно — клиент не может
 * запросить чужие тикеты никаким значением фильтра, сам параметр `createdBy` не читается из
 * HTTP-входа, см. `support-tickets.controller.ts`).
 *
 * Возвращает ПЛОСКИЙ `SupportTicketListItem` (application-слой), НЕ доменный `SupportTicket` —
 * presentation не имеет права импортировать `domain/` напрямую (`dependency-cruiser`
 * `presentation-goes-through-application`, `02` §1.1) даже транзитивно через тип результата use
 * case. `toSupportTicketListItem` экспортирован — переиспользуется `get-support-ticket.use-case.ts`
 * (детальный вид расширяет ЭТИ ЖЕ поля `messages`-массивом, не дублирует их).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { SupportTicketCategory, SupportTicketChannel, SupportTicketStatus } from '@dorutj/contracts'
import type { SupportTicket } from '../../domain/index.js'
import {
  SUPPORT_TICKETS_REPOSITORY,
  type SupportTicketsRepositoryPort,
} from '../ports/support-tickets-repository.port.js'
import { SupportTicketsPolicy, type SupportTicketsPolicyActor } from '../support-tickets.policy.js'

export interface ListSupportTicketsCursor {
  readonly v: string
  readonly id: string
}

export interface ListSupportTicketsCommand {
  readonly actor: SupportTicketsPolicyActor
  readonly status?: SupportTicketStatus
  readonly category?: string
  readonly priority?: number
  readonly limit: number
  readonly cursor?: ListSupportTicketsCursor | null
}

/** Плоская проекция `SupportTicket` (application-слой) — см. JSDoc файла про границу presentation/domain. */
export interface SupportTicketListItem {
  readonly id: string
  readonly tenantId: string
  readonly orderId: string | null
  readonly channel: SupportTicketChannel
  readonly category: SupportTicketCategory
  readonly status: SupportTicketStatus
  readonly priority: number
  readonly createdBy: string | null
  readonly description: string | null
  readonly firstResponseDueAt: Date | null
  readonly firstRespondedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface ListSupportTicketsResult {
  readonly items: readonly SupportTicketListItem[]
  readonly nextCursor: ListSupportTicketsCursor | null
  readonly hasMore: boolean
}

@Injectable()
export class ListSupportTicketsUseCase {
  public constructor(@Inject(SUPPORT_TICKETS_REPOSITORY) private readonly repository: SupportTicketsRepositoryPort) {}

  public async execute(command: ListSupportTicketsCommand): Promise<ListSupportTicketsResult> {
    const scopeToOwn = !SupportTicketsPolicy.canListAll(command.actor)
    const page = await this.repository.list({
      tenantId: command.actor.tenantId,
      limit: command.limit,
      cursor: command.cursor ?? null,
      ...(scopeToOwn && { createdBy: command.actor.userId }),
      ...(command.status !== undefined && { status: command.status }),
      ...(command.category !== undefined && { category: command.category }),
      ...(command.priority !== undefined && { priority: command.priority }),
    })
    return { items: page.items.map(toSupportTicketListItem), nextCursor: page.nextCursor, hasMore: page.hasMore }
  }
}

export function toSupportTicketListItem(ticket: SupportTicket): SupportTicketListItem {
  return {
    id: ticket.id,
    tenantId: ticket.tenantId,
    orderId: ticket.orderId,
    channel: ticket.channel,
    category: ticket.category.value,
    status: ticket.status,
    priority: ticket.priority,
    createdBy: ticket.createdBy,
    description: ticket.description,
    firstResponseDueAt: ticket.firstResponseDueAt,
    firstRespondedAt: ticket.firstRespondedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  }
}
