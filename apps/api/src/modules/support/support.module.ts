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
 */
import { Module } from '@nestjs/common'

@Module({
  controllers: [],
  providers: [],
})
// NestJS module marker class: Nest требует класс-носитель декоратора @Module, providers
// регистрируются декоратором, а не телом класса (тот же приём, что modules/payments/orders).
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module marker class, см. комментарий выше
export class SupportModule {}
