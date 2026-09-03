/**
 * Ре-экспорт `InvalidReturnStatusTransitionError` (`@dorutj/contracts`, `domain-errors.ts`).
 * В отличие от `duplicate-active-return.error.ts`/соседних файлов этого каталога, класс НЕ
 * существовал до этого тикета — добавлен ОДНОЙ строкой (D-27) рядом с сиблингами
 * `InvalidOrderStatusTransitionError`/`InvalidPrescriptionTransitionError`/
 * `InvalidOnboardingTransitionError` (тот же `ForbiddenTransitionError`, код
 * `ErrorCode.INVALID_STATE_TRANSITION`, 409) — единый каталог доменных ошибок остаётся
 * единственным источником для ВСЕХ переходов состояний проекта, не только `orders` (правило 12
 * AGENTS.md — не заводить второй параллельный стиль ошибок state machine для `returns`).
 */
export { InvalidReturnStatusTransitionError } from '@dorutj/contracts'
