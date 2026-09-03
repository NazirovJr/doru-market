/**
 * Ре-экспорт `ControlledSubstanceMustBeDestroyedError` (`@dorutj/contracts`, `domain-errors.ts`)
 * — тот же случай, что `duplicate-active-return.error.ts` этого каталога: класс уже существует
 * в едином каталоге доменных ошибок проекта (сообщение/код
 * `ErrorCode.CONTROLLED_SUBSTANCE_MUST_BE_DESTROYED`, 422 — 1:1 с SRS-DOM-054), не дублируется
 * здесь под тем же именем (правило 12 AGENTS.md).
 */
export { ControlledSubstanceMustBeDestroyedError } from '@dorutj/contracts'
