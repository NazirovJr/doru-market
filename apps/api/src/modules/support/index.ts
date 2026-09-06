/**
 * Публичный фасад модуля `support` (EP-14, DTJ-270/281).
 *
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2: единственный легальный путь межмодульного
 * взаимодействия для чужих bounded contexts. Импорт `modules/support/domain|application|
 * infrastructure|presentation` напрямую — блокирующее нарушение (`dependency-cruiser`,
 * `no-cross-module-deep-import`). Тот же приём, что `modules/payments/index.ts`
 * (`PAYMENTS_FACADE`)/`modules/returns/index.ts` (`RETURNS_FACADE`).
 */

/** DI-токен провайдера `SupportFacade` (`{ provide: SUPPORT_FACADE, useFactory: ... }`, см. `support.module.ts`). */
export const SUPPORT_FACADE = Symbol.for('@dorutj/support/support-facade')

/**
 * ДОБАВЛЕНО (DTJ-281) — интерфейс `SupportFacade` прибыл первыми тремя методами, как и
 * предсказывал JSDoc DTJ-270 (см. историю файла). Форма живёт в `application/ports/
 * support-facade.port.ts` (тот же приём, что `payments/index.ts` — порт объявляется в
 * `application/`, `index.ts` лишь ре-экспортирует тип); реализация — `useFactory` в
 * `support.module.ts`, оборачивающий `CreateSupportTicketUseCase`/`CreateAutoSupportTicketUseCase`/
 * `EscalateTicketPriorityUseCase`. Домен/application НЕ реэкспортируются целиком — только
 * перечисленное ниже (`02` §1.2: «Всё остальное внутри модуля — приватно»).
 */
export type {
  SupportFacade,
  SupportTicketSummary,
  CreateSupportTicketFacadeInput,
  CreateSupportTicketFacadeResult,
  CreateAutoSupportTicketFacadeInput,
  EscalateTicketPriorityFacadeResult,
} from './application/ports/support-facade.port.js'
