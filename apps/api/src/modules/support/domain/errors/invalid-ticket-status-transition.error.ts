/**
 * `InvalidTicketStatusTransitionError` (EP-14, DTJ-278) — недопустимый переход
 * `support_ticket_status`, не связанный с терминальностью `closed` (см. `TicketAlreadyTerminalError`
 * для этого отдельного случая — ticket text DTJ-278 различает их явно).
 *
 * Локальное определение — тот же приём, что `ticket-not-found.error.ts` этого же каталога.
 */
const INVALID_TICKET_STATUS_TRANSITION_CODE = 'INVALID_TICKET_STATUS_TRANSITION'

export class InvalidTicketStatusTransitionError extends Error {
  public readonly code = INVALID_TICKET_STATUS_TRANSITION_CODE

  public constructor(
    public readonly ticketId: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`SupportTicket "${ticketId}": invalid transition ${from} -> ${to}`)
    this.name = new.target.name
  }
}
