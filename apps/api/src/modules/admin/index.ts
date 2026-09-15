/**
 * Публичный барабан модуля `admin` (D-27, DTJ-350).
 *
 * `admin` типично ПОТРЕБИТЕЛЬ чужих фасадов (`onboarding`/`orders`/`payments`/`inventory`), а не
 * их поставщик (`SRS-ADM-002`) — `AdminFacade` для других модулей, вероятно, останется пустым
 * весь R1 (см. «Что сделать» п.2 тикета DTJ-350). Пустой `export interface AdminFacade {}` не
 * заведён здесь: он структурно эквивалентен `unknown`/`object` и запрещён линтером
 * (`@typescript-eslint/no-empty-object-type`) — тот же приём отложенного объявления, что
 * `PaymentsFacade` в `modules/payments/index.ts` до своего первого метода (DTJ-249). Появится
 * добавлением строки, если/когда какому-то модулю понадобится читать что-то из `admin`.
 *
 * Прямой импорт `modules/admin/domain|application|infrastructure|presentation` из другого
 * модуля — блокирующее нарушение `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2 (ловится
 * `pnpm arch:check`). Импортируйте только из этого файла.
 */
export { AdminModule } from './admin.module.js'
