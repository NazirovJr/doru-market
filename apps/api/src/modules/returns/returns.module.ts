/**
 * NestJS-модуль `returns` (EP-11, DTJ-270). Barrel-файл (D-27): правится ТОЛЬКО добавлением
 * строк, перечитать перед правкой, конфликты слияния — за архитектором.
 *
 * DTJ-270 наполняет `providers`/`controllers` ПУСТЫМИ массивами намеренно (тот же приём, что
 * `payments.module.ts` DTJ-236) — на этом шаге модуль несёт только физический каркас (миграция
 * `0037_returns_disputes_support.sql`, Drizzle-схема `db/schema/returns.ts`/`support.ts`, четыре
 * порта к чужим модулям `application/ports/*-facade.port.ts`, публичный фасад `index.ts`). Ни
 * одного use case/адаптера этого модуля ещё не существует — биндить нечего. Модуль тем не менее
 * ЗАРЕГИСТРИРОВАН в `AppModule.imports` (см. `app.module.ts`), чтобы «пустой, но подключённый»
 * модуль отличался от «написанного, но неподключённого кода» (правило 2 AGENTS.md):
 * `pnpm --filter api build`/DI-резолвинг реального Nest-контейнера уже сегодня проверяют, что
 * модуль синтаксически валиден и не порождает циклических импортов, раньше, чем первый провайдер
 * появится и потенциально сломает граф.
 *
 * DTJ-271 (домен `OrderReturn`, VO, ошибки, state machine) — ЧИСТЫЙ `domain/`, ноль
 * `@nestjs/*`-импортов (`02` §2.6) — НЕ требует правки этого файла: домен не является Nest-
 * провайдером, use case, который его свяжет с DI, — DTJ-273 (вне периметра этой волны).
 *
 * DTJ-272 (`ReturnFinancialOutcomeResolver`, `application/policies/`) добавляет ОДНУ строку в
 * `providers` (D-27) — чистая функция без зависимостей (не читает БД, не вызывает порты), тем
 * не менее регистрируется провайдером (тот же приём, что `ESCROW_LEDGER_REPOSITORY` в
 * `payments.module.ts` DTJ-240: «провайдер резолвится в DI-графе заранее, вызывающий код —
 * DTJ-274 — появится позже») — резолвинг Nest проверяется уже сегодня, не откладывается до
 * появления первого потребителя.
 */
import { Module } from '@nestjs/common'
import { ReturnFinancialOutcomeResolver } from './application/policies/return-financial-outcome.policy.js'

@Module({
  controllers: [],
  providers: [ReturnFinancialOutcomeResolver],
})
// NestJS module marker class: Nest требует класс-носитель декоратора @Module, providers
// регистрируются декоратором, а не телом класса (тот же приём, что modules/payments/orders).
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module marker class, см. комментарий выше
export class ReturnsModule {}
