/**
 * Ре-экспорт `UnsupportedReturnReasonError` (`@dorutj/contracts`, `domain-errors.ts`).
 *
 * Файл СВЕРХ буквального `files_owned` DTJ-271 (тот же приём, что `0034_support_tickets_
 * audit_log.sql` JSDoc цитирует для DTJ-240: «добавил escrow-ledger-repository.port.ts сверх
 * буквального списка», правило 11 AGENTS.md) — `OrderReturn.request()` (`order-return.entity.ts`,
 * этот же тикет) физически бросает этот класс для `reason='undelivered'` (SRS-RET-003), а
 * `ReturnFinancialOutcomeResolver.resolve()` (DTJ-272, следующий тикет) переиспользует ЕГО ЖЕ
 * («тот же класс, что в DTJ-271, реэкспортирован» — буквальный текст DTJ-272 п.4) — без этого
 * файла оба тикета не имели бы единой точки импорта класса, добавленного решением CTO D-EP11-5
 * (`reports/EP11-EP14-CTO-BRIEF.md`) в `@dorutj/contracts` этим же тикетом.
 */
export { UnsupportedReturnReasonError } from '@dorutj/contracts'
