/**
 * Порт `SupportTicketsRepositoryPort` (EP-14, DTJ-279, расширен DTJ-282).
 *
 * `list()`/`saveMessage()`/`listMessagesByTicketId()` — ДОБАВЛЕНО DTJ-282 сверх буквального
 * `files_owned` тикета (тот же приём, что `support-unit-of-work.port.ts`, DTJ-279, добавивший
 * файл сверх списка — правило 11 AGENTS.md): `GET /`/`GET /:id`/`POST /:id/messages` физически
 * не могут обойтись `save()`/`findById()` в одиночку. `list()` возвращает `SupportTicket[]`
 * (полные доменные агрегаты, не облегчённая проекция) — тот же выбор, что `findById`: объём
 * очереди поддержки (десятки-сотни тикетов на страницу) не оправдывает второй, урезанный путь
 * чтения только ради списка (в отличие от `OrderQueueRow`, `orders/application/ports/
 * order-repository.port.ts`, где объём и частота обращения на порядки выше). Presentation
 * (`support-ticket.mapper.ts`) НЕ видит эти агрегаты напрямую — только через плоские view-типы
 * `application/use-cases/list-support-tickets.use-case.ts`/`get-support-ticket.use-case.ts`
 * (`dependency-cruiser` `presentation-goes-through-application`, `02` §1.1: presentation не
 * импортирует `domain/` ни напрямую, ни транзитивно через тип результата use case).
 */
import type { SupportTicketStatus } from '@dorutj/contracts'
import type { SupportTicket, SupportTicketMessage } from '../../domain/index.js'
import type { SupportUnitOfWorkTx } from './support-unit-of-work.port.js'

export const SUPPORT_TICKETS_REPOSITORY = Symbol.for('@dorutj/support/tickets-repository')

/** Курсор keyset-пагинации `list()` — `v`: ISO `createdAt` последней строки страницы, `id` — её id (тот же приём, что `PayoutCursor`, DTJ-252). */
export interface SupportTicketListCursor {
  readonly v: string
  readonly id: string
}

export interface SupportTicketListFilter {
  readonly tenantId: string
  /** `undefined` — сотрудник поддержки (видит ВСЕ тикеты тенанта); задан — скоуп «только свои» (DTJ-282, `ListSupportTicketsUseCase`). */
  readonly createdBy?: string
  readonly status?: SupportTicketStatus
  readonly category?: string
  readonly priority?: number
  readonly limit: number
  readonly cursor?: SupportTicketListCursor | null
}

export interface SupportTicketListPage {
  readonly items: readonly SupportTicket[]
  readonly nextCursor: SupportTicketListCursor | null
  readonly hasMore: boolean
}

export interface SupportTicketsRepositoryPort {
  save(ticket: SupportTicket, tx?: SupportUnitOfWorkTx): Promise<void>
  findById(id: string, tx?: SupportUnitOfWorkTx): Promise<SupportTicket | null>
  list(filter: SupportTicketListFilter, tx?: SupportUnitOfWorkTx): Promise<SupportTicketListPage>
  saveMessage(message: SupportTicketMessage, tx?: SupportUnitOfWorkTx): Promise<void>
  listMessagesByTicketId(ticketId: string, tx?: SupportUnitOfWorkTx): Promise<readonly SupportTicketMessage[]>
}
