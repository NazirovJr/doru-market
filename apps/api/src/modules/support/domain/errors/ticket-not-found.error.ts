/**
 * `TicketNotFoundError` (EP-14, DTJ-278).
 *
 * Локальное определение (не `packages/contracts`) — тот же приём, что `modules/payments/
 * domain/errors/adjustment-requires-reason.error.ts` (DTJ-240): `domain/` `support` не
 * зависит от общего каталога ошибок EP-01, остаётся переносимым без инфраструктуры. Проверено
 * (`grep -rn "TicketNotFoundError" packages/contracts`) — эквивалента нет, дублирования не
 * происходит.
 */
const TICKET_NOT_FOUND_CODE = 'TICKET_NOT_FOUND'

export class TicketNotFoundError extends Error {
  public readonly code = TICKET_NOT_FOUND_CODE

  public constructor(public readonly ticketId: string) {
    super(`SupportTicket "${ticketId}" not found`)
    this.name = new.target.name
  }
}
