/**
 * Ре-экспорт `TicketNotFoundError` (`@dorutj/contracts`, `domain-errors-support.ts`, DTJ-282) —
 * централизован при реализации DTJ-282: `AllExceptionsFilter` (DTJ-018) распознаёт ТОЛЬКО
 * `instanceof DomainError`, а этот класс изначально (DTJ-278) был обычным `Error`-потомком
 * («домен остаётся переносимым без инфраструктуры») — DTJ-282 «Что сделать» п.5/DoD прямо
 * требует `404 TICKET_NOT_FOUND` через «уже установленный единый фильтр», не третий фильтр
 * ошибок для этого модуля. Тот же приём, что `modules/returns/domain/errors/
 * duplicate-active-return.error.ts` — `modules/support/domain/errors/` остаётся полным
 * внутренним справочником ошибок модуля (используется `domain/index.ts`), без второй копии
 * реализации класса под тем же именем (правило 12 AGENTS.md).
 */
export { TicketNotFoundError } from '@dorutj/contracts'
