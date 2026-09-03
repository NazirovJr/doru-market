/**
 * Публичный фасад модуля `support` (EP-14, DTJ-270, скаффолдинг).
 *
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2: единственный легальный путь межмодульного
 * взаимодействия для чужих bounded contexts. Импорт `modules/support/domain|application|
 * infrastructure|presentation` напрямую — блокирующее нарушение (`dependency-cruiser`,
 * `no-cross-module-deep-import`). Тот же приём, что `modules/payments/index.ts`
 * (`PAYMENTS_FACADE`)/`modules/returns/index.ts` (`RETURNS_FACADE`).
 *
 * На этом шаге (DTJ-270) `SupportFacade` — ПУСТОЙ контракт: ни одного use case модуля ещё не
 * реализовано (домен — DTJ-278, `CreateSupportTicketUseCase` — DTJ-279, вне периметра этой
 * волны за пределами DTJ-279). Токен `SUPPORT_FACADE` объявлен здесь заранее, но НЕ забинжен ни
 * к одному провайдеру в `support.module.ts` до появления первой реализации (правило 15
 * AGENTS.md неприменимо — маркер нужен только когда ЕСТЬ вызывающий код).
 *
 * Интерфейс `SupportFacade` появится в этом файле ДОБАВЛЕНИЕМ (D-27), когда первый use case
 * модуля будет готов — пустой `interface {}` запрещён линтером
 * (`@typescript-eslint/no-empty-object-type`) как вводящий в заблуждение.
 */

/** DI-токен для будущего провайдера `SupportFacade` (`{ provide: SUPPORT_FACADE, useClass: ... }`). */
export const SUPPORT_FACADE = Symbol.for('@dorutj/support/support-facade')
