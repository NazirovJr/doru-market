/**
 * Порт `SupportTicketsRepositoryPort` (EP-14, DTJ-279).
 */
import type { SupportTicket } from '../../domain/index.js'
import type { SupportUnitOfWorkTx } from './support-unit-of-work.port.js'

export const SUPPORT_TICKETS_REPOSITORY = Symbol.for('@dorutj/support/tickets-repository')

export interface SupportTicketsRepositoryPort {
  save(ticket: SupportTicket, tx?: SupportUnitOfWorkTx): Promise<void>
  findById(id: string, tx?: SupportUnitOfWorkTx): Promise<SupportTicket | null>
}
