/**
 * `TicketAlreadyTerminalError` (EP-14, DTJ-278) — мутация тикета в терминальном статусе
 * `closed` (в отличие от `resolved`, `closed` терминален без исключений — ticket text DTJ-278
 * п.4: «Терминальный closed — любая мутация после него бросает TicketAlreadyTerminalError»).
 *
 * Локальное определение — тот же приём, что `ticket-not-found.error.ts` этого же каталога.
 */
const TICKET_ALREADY_TERMINAL_CODE = 'TICKET_ALREADY_TERMINAL'

export class TicketAlreadyTerminalError extends Error {
  public readonly code = TICKET_ALREADY_TERMINAL_CODE

  public constructor(public readonly ticketId: string) {
    super(`SupportTicket "${ticketId}" is already terminal (closed)`)
    this.name = new.target.name
  }
}
