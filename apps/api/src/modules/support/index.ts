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
import type {
  CreateSupportTicketCommand,
  CreateSupportTicketResult,
} from './application/use-cases/create-support-ticket.use-case.js'

/** DI-токен для будущего провайдера `SupportFacade` (`{ provide: SUPPORT_FACADE, useClass: ... }`). */
export const SUPPORT_FACADE = Symbol.for('@dorutj/support/support-facade')

/**
 * ДОБАВЛЕНО (EP-11, DTJ-273) — интерфейс `SupportFacade` прибыл первым реальным методом
 * (`createAutoOrManualTicket`), как и предсказывал JSDoc выше (DTJ-270). Первый межмодульный
 * потребитель — `returns → support` (`RequestReturnUseCase`, SRS-RET-003: `reason='undelivered'`
 * переадресуется в обращение вместо `OrderReturn`). Метод обёртки назван иначе, чем
 * `CreateSupportTicketUseCase.execute` (тот же приём несовпадения имён, что
 * `PaymentsFacade.holdPayout` ↔ `HoldPayoutUseCase.execute`, `modules/payments/payments.module.ts`
 * DTJ-249) — форма фиксируется здесь, реализация — `useFactory` в `support.module.ts`.
 */
export interface SupportFacade {
  createAutoOrManualTicket(command: CreateSupportTicketCommand): Promise<CreateSupportTicketResult>
}

export type {
  CreateSupportTicketCommand,
  CreateSupportTicketResult,
} from './application/use-cases/create-support-ticket.use-case.js'
