/**
 * NestJS-модуль `support` (EP-14, DTJ-270). Barrel-файл (D-27): правится ТОЛЬКО добавлением
 * строк, перечитать перед правкой, конфликты слияния — за архитектором.
 *
 * DTJ-270 наполняет `providers`/`controllers` ПУСТЫМИ массивами намеренно (тот же приём, что
 * `payments.module.ts` DTJ-236/`returns.module.ts` DTJ-270) — на этом шаге модуль несёт только
 * физический каркас (Drizzle-схема `db/schema/support.ts`, публичный фасад `index.ts`). Ни
 * одного use case/адаптера этого модуля ещё не существует — биндить нечего. Модуль тем не менее
 * ЗАРЕГИСТРИРОВАН в `AppModule.imports` (см. `app.module.ts`), тот же приём, что `ReturnsModule`
 * (правило 2 AGENTS.md — «пустой, но подключённый» модуль отличается от «написанного, но
 * неподключённого кода»).
 *
 * DTJ-278 (домен `SupportTicket`/`SupportTicketMessage`, VO, ошибки) — ЧИСТЫЙ `domain/`, ноль
 * `@nestjs/*`-импортов (`02` §2.6) — НЕ требует правки этого файла.
 *
 * DTJ-279 (`CreateSupportTicketUseCase` + порты + адаптеры) добавляет провайдеры сюда строками
 * (D-27) — единственная точка создания обращения (SRS-ADM-053/074).
 *
 * DTJ-280 (`EscalateTicketPriorityUseCase` + `EscalateTicketPriorityController` internal-мост
 * `apps/worker → apps/api`) добавляет провайдер/контроллер той же строчной аддитивной техникой.
 *
 * DTJ-281 (`SupportFacade` реальный, `CreateAutoSupportTicketUseCase`) — `SUPPORT_FACADE`
 * (`index.ts`) забинжен `useFactory`, оборачивающим три use case'а модуля в форму `SupportFacade`
 * (тот же приём, что `PAYMENTS_FACADE` в `payments.module.ts`, DTJ-249). С этого тикета
 * `EscalateTicketPriorityController` тоже вызывает `EscalateTicketPriorityUseCase` ТОЛЬКО через
 * этот фасад (единообразие точки входа, ticket «Что сделать» п.3) — поэтому порядок объявления
 * провайдеров ниже важен: `SUPPORT_FACADE` объявлен ПОСЛЕ трёх use case'ов, от которых зависит.
 *
 * Модуль `disputes` (EP-14, `order_disputes`/`dispute_status_history`) НЕ заводится этим файлом
 * и НЕ входит в этот диапазон тикетов (D-EP11-6) — таблицы существуют как фундамент
 * (`db/schema/support.ts`), домен/use case поверх них — R3-3 за флагом
 * `disputes_workflow_enabled`.
 */
import { Module } from '@nestjs/common'
import { CreateSupportTicketUseCase } from './application/use-cases/create-support-ticket.use-case.js'
import { CreateAutoSupportTicketUseCase } from './application/use-cases/create-auto-support-ticket.use-case.js'
import { EscalateTicketPriorityUseCase } from './application/use-cases/escalate-ticket-priority.use-case.js'
import { SUPPORT_TICKETS_REPOSITORY_PROVIDER } from './infrastructure/repositories/drizzle-support-tickets.repository.js'
import { SUPPORT_ORDERS_FACADE_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-support-orders-facade.adapter.js'
import { SUPPORT_TENANT_SETTINGS_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-support-tenant-settings.adapter.js'
import { SUPPORT_UNIT_OF_WORK_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-support-unit-of-work.adapter.js'
import { SUPPORT_OUTBOX_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-support-outbox.adapter.js'
import { EscalateTicketPriorityController } from './presentation/internal/escalate-ticket-priority.controller.js'
import { SUPPORT_FACADE, type SupportFacade } from './index.js'

@Module({
  controllers: [EscalateTicketPriorityController],
  providers: [
    SUPPORT_TICKETS_REPOSITORY_PROVIDER,
    SUPPORT_ORDERS_FACADE_DRIZZLE_PROVIDER,
    SUPPORT_TENANT_SETTINGS_DRIZZLE_PROVIDER,
    SUPPORT_UNIT_OF_WORK_DRIZZLE_PROVIDER,
    SUPPORT_OUTBOX_DRIZZLE_PROVIDER,
    CreateSupportTicketUseCase,
    CreateAutoSupportTicketUseCase,
    EscalateTicketPriorityUseCase,
    // DTJ-281 — см. JSDoc блока providers выше.
    {
      provide: SUPPORT_FACADE,
      useFactory: (
        createTicket: CreateSupportTicketUseCase,
        createAutoTicket: CreateAutoSupportTicketUseCase,
        escalatePriority: EscalateTicketPriorityUseCase,
      ): SupportFacade => ({
        createTicket: (input) => createTicket.execute(input),
        createAutoTicket: (input) => createAutoTicket.execute(input),
        escalateTicketPriority: (ticketId) => escalatePriority.execute({ ticketId }),
      }),
      inject: [CreateSupportTicketUseCase, CreateAutoSupportTicketUseCase, EscalateTicketPriorityUseCase],
    },
  ],
})
// NestJS module marker class: Nest требует класс-носитель декоратора @Module, providers
// регистрируются декоратором, а не телом класса (тот же приём, что modules/payments/orders).
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module marker class, см. комментарий выше
export class SupportModule {}
