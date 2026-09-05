/**
 * Ре-экспорт `RestockConditionsNotMetError` (`@dorutj/contracts`, `domain-errors.ts`) — тот же
 * случай, что `duplicate-active-return.error.ts` этого каталога: класс уже существует в едином
 * каталоге доменных ошибок проекта (сообщение/код `ErrorCode.RESTOCK_CONDITIONS_NOT_MET`, 422
 * — 1:1 с SRS-DOM-053), не дублируется здесь под тем же именем (правило 12 AGENTS.md).
 */
export { RestockConditionsNotMetError } from '@dorutj/contracts'
