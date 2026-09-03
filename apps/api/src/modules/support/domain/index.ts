/**
 * Внутренний баррель `domain/` модуля `support` (EP-14, DTJ-278).
 *
 * НЕ путать с публичным фасадом `modules/support/index.ts` (DTJ-270) — тот НЕ реэкспортирует
 * `domain` наружу модуля (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2). Используется ТОЛЬКО
 * внутри `support`.
 */
export { SupportTicket, type SupportTicketOpenCommand, type SupportTicketSnapshot } from './support-ticket.entity.js'
export {
  SupportTicketMessage,
  type SupportTicketMessageCreateProps,
  type SupportTicketMessageSnapshot,
} from './support-ticket-message.entity.js'
export { SupportTicketCategory } from './value-objects/support-ticket-category.vo.js'
export { TicketNotFoundError } from './errors/ticket-not-found.error.js'
export { InvalidTicketStatusTransitionError } from './errors/invalid-ticket-status-transition.error.js'
export { TicketAlreadyTerminalError } from './errors/ticket-already-terminal.error.js'
