/**
 * Ре-экспорт `TicketAlreadyTerminalError` (`@dorutj/contracts`, `domain-errors-support.ts`,
 * DTJ-282) — тот же приём/причина, что `ticket-not-found.error.ts` этого же каталога:
 * централизация к `DomainError`, чтобы `AllExceptionsFilter` (DTJ-018) распознавал класс без
 * второго фильтра ошибок для этого модуля.
 */
export { TicketAlreadyTerminalError } from '@dorutj/contracts'
