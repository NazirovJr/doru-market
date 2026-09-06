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
 * Модуль `disputes` (EP-14, `order_disputes`/`dispute_status_history`) НЕ заводится этим файлом
 * и НЕ входит в этот диапазон тикетов (D-EP11-6) — таблицы существуют как фундамент
 * (`db/schema/support.ts`), домен/use case поверх них — R3-3 за флагом
 * `disputes_workflow_enabled`.
 *
 * DTJ-273 (EP-11, файл СВЕРХ буквального `files_owned` — правило 11 AGENTS.md, барабан правится
 * добавлением, правило 8) — первый реальный провайдер `SUPPORT_FACADE` (объявлен `index.ts` ещё
 * DTJ-270, пустым до сих пор): `useFactory` оборачивает `CreateSupportTicketUseCase.execute` в
 * форму `SupportFacade.createAutoOrManualTicket` (разные имена метода, см. JSDoc `index.ts`), тот
 * же приём, что `PAYMENTS_FACADE`/`HoldPayoutUseCase` в `payments.module.ts` (DTJ-249).
 */
import { Module } from '@nestjs/common'
import { CreateSupportTicketUseCase } from './application/use-cases/create-support-ticket.use-case.js'
import { SUPPORT_TICKETS_REPOSITORY_PROVIDER } from './infrastructure/repositories/drizzle-support-tickets.repository.js'
import { SUPPORT_ORDERS_FACADE_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-support-orders-facade.adapter.js'
import { SUPPORT_TENANT_SETTINGS_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-support-tenant-settings.adapter.js'
import { SUPPORT_UNIT_OF_WORK_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-support-unit-of-work.adapter.js'
import { SUPPORT_OUTBOX_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-support-outbox.adapter.js'
import { SUPPORT_FACADE, type SupportFacade } from './index.js'

@Module({
  controllers: [],
  providers: [
    SUPPORT_TICKETS_REPOSITORY_PROVIDER,
    SUPPORT_ORDERS_FACADE_DRIZZLE_PROVIDER,
    SUPPORT_TENANT_SETTINGS_DRIZZLE_PROVIDER,
    SUPPORT_UNIT_OF_WORK_DRIZZLE_PROVIDER,
    SUPPORT_OUTBOX_DRIZZLE_PROVIDER,
    CreateSupportTicketUseCase,
    // DTJ-273 — SUPPORT_FACADE, первый провайдер (см. JSDoc блока providers выше).
    {
      provide: SUPPORT_FACADE,
      useFactory: (useCase: CreateSupportTicketUseCase): SupportFacade => ({
        createAutoOrManualTicket: (command) => useCase.execute(command),
      }),
      inject: [CreateSupportTicketUseCase],
    },
  ],
  // DTJ-273 — `SUPPORT_FACADE` виден `ReturnsModule` через `imports: [SupportModule]` (её module-local,
  // НЕ `@Global()` — единственный сегодняшний межмодульный потребитель, тот же явный приём, что
  // `TenancyModule`/`PaymentsModule` в `orders.module.ts`, не расширение видимости молча).
  exports: [SUPPORT_FACADE],
})
// NestJS module marker class: Nest требует класс-носитель декоратора @Module, providers
// регистрируются декоратором, а не телом класса (тот же приём, что modules/payments/orders).
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module marker class, см. комментарий выше
export class SupportModule {}
