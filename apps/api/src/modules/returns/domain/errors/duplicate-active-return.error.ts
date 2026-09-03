/**
 * Ре-экспорт `DuplicateActiveReturnError` (`@dorutj/contracts`, `domain-errors.ts`) — класс УЖЕ
 * существует в едином каталоге доменных ошибок проекта (DTJ-005 транскрибировал ПОЛНОЕ дерево
 * `10-domain-model.md` §«Доменные ошибки» заранее, для всех эпиков, включая ещё не начатые на
 * момент DTJ-005 — см. header-комментарий `domain-errors.ts`: «единый специфицированный каталог
 * доменных ошибок ВСЕГО ПРОЕКТА»).
 *
 * DTJ-271 называет этот файл в `files_owned`, как будто класс нужно создавать заново — проверено
 * (`grep -rn "DuplicateActiveReturnError" packages/contracts`) ПЕРЕД реализацией: сообщение
 * («An active return already exists»), код (`ErrorCode.RETURN_ALREADY_ACTIVE`, 409) и назначение
 * 1:1 совпадают с тем, что нужно этой сущности (SRS-DOM-052, аналог TC-DOM-028). Дублирование
 * класса под тем же именем в другом файле — прямое нарушение правила 12 AGENTS.md («прежде чем
 * создать — найди») и того самого антипаттерна, который уже стоил проекту двух живых копий
 * `Dosage`/`Barcode`/`DosageForm` (волна 3.5, `docs/07-WAVE4-HANDOFF.md` §4.1). Ре-экспорт здесь
 * — не работа впустую: `modules/returns/domain/errors/` остаётся полным внутренним справочником
 * ошибок модуля (используется `domain/index.ts`), файл по пути `files_owned` существует, но без
 * второй копии реализации.
 */
export { DuplicateActiveReturnError } from '@dorutj/contracts'
