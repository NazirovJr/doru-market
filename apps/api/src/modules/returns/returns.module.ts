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
 *
 * DTJ-273 — первые use case'ы/адаптеры модуля. `imports: [TenancyModule, SupportModule]` — оба
 * НЕ `@Global()` (в отличие от `OrdersModule`/`AuthModule`), тот же явный приём, что
 * `orders.module.ts`/`payments.module.ts` для `TenancyModule`. `RETURNS_DELIVERY_PORT` биндится
 * NullAdapter'ом (правило 15 AGENTS.md, TODO(EP-13) — см. JSDoc адаптера): модуль `delivery` на
 * этой волне содержит только domain-слой, реального провайдера ещё нет.
 */
import { Module } from '@nestjs/common'
import { TenancyModule } from '@/modules/tenancy/tenancy.module.js'
import { SupportModule } from '@/modules/support/support.module.js'
import { ReturnFinancialOutcomeResolver } from './application/policies/return-financial-outcome.policy.js'
import { RequestReturnUseCase } from './application/use-cases/request-return.use-case.js'
import { MarkReturnInTransitUseCase } from './application/use-cases/mark-return-in-transit.use-case.js'
import { ConfirmReturnReceivedUseCase } from './application/use-cases/confirm-return-received.use-case.js'
import { RejectReturnUseCase } from './application/use-cases/reject-return.use-case.js'
import { AdminOverrideReturnUseCase } from './application/use-cases/admin-override-return.use-case.js'
import { RetryReturnTransitUseCase } from './application/use-cases/retry-return-transit.use-case.js'
import { RefundOnReturnResolvedUseCase } from './application/use-cases/refund-on-return-resolved.use-case.js'
import { RefundOnReturnResolvedSubscriber } from './application/use-cases/refund-on-return-resolved.subscriber.js'
import { RETURNS_REPOSITORY_PROVIDER } from './infrastructure/repositories/drizzle-returns.repository.js'
import { RETURNS_UNIT_OF_WORK_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-returns-unit-of-work.adapter.js'
import { RETURNS_OUTBOX_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-returns-outbox.adapter.js'
import { RETURNS_ORDERS_FACADE_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-returns-orders-facade.adapter.js'
import { RETURNS_INVENTORY_FACADE_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-returns-inventory-facade.adapter.js'
import { RETURNS_TENANT_SETTINGS_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-returns-tenant-settings.adapter.js'
import { RETURNS_SUPPORT_FACADE_PROVIDER } from './infrastructure/adapters/returns-support-facade.adapter.js'
import { RETURNS_PROCESSED_EVENTS_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-returns-processed-events.adapter.js'
import { RETURNS_DELIVERY_PORT } from './application/ports/delivery-facade.port.js'
import { UnimplementedReturnsDeliveryAdapter } from './infrastructure/adapters/unimplemented-returns-delivery-facade.adapter.js'
import { RETURNS_PAYMENTS_PORT } from './application/ports/payments-facade.port.js'
import { UnimplementedReturnsPaymentsAdapter } from './infrastructure/adapters/unimplemented-returns-payments-facade.adapter.js'

@Module({
  imports: [TenancyModule, SupportModule],
  controllers: [],
  providers: [
    ReturnFinancialOutcomeResolver,
    RETURNS_REPOSITORY_PROVIDER,
    RETURNS_UNIT_OF_WORK_DRIZZLE_PROVIDER,
    RETURNS_OUTBOX_DRIZZLE_PROVIDER,
    RETURNS_ORDERS_FACADE_DRIZZLE_PROVIDER,
    RETURNS_INVENTORY_FACADE_DRIZZLE_PROVIDER,
    RETURNS_TENANT_SETTINGS_DRIZZLE_PROVIDER,
    RETURNS_SUPPORT_FACADE_PROVIDER,
    RETURNS_PROCESSED_EVENTS_DRIZZLE_PROVIDER,
    // TODO(EP-13): заменить на реальный адаптер, когда у `delivery` появится публичный фасад.
    { provide: RETURNS_DELIVERY_PORT, useClass: UnimplementedReturnsDeliveryAdapter },
    // TODO(EP-10): заменить, когда `PaymentsFacade` вырастет refund/adjustment-методами — см.
    // JSDoc `UnimplementedReturnsPaymentsAdapter` (БЛОКЕР для прод-мержа DTJ-274, не для кода).
    { provide: RETURNS_PAYMENTS_PORT, useClass: UnimplementedReturnsPaymentsAdapter },
    RequestReturnUseCase,
    MarkReturnInTransitUseCase,
    ConfirmReturnReceivedUseCase,
    RejectReturnUseCase,
    AdminOverrideReturnUseCase,
    RetryReturnTransitUseCase,
    RefundOnReturnResolvedUseCase,
    RefundOnReturnResolvedSubscriber,
  ],
})
// NestJS module marker class: Nest требует класс-носитель декоратора @Module, providers
// регистрируются декоратором, а не телом класса (тот же приём, что modules/payments/orders).
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module marker class, см. комментарий выше
export class ReturnsModule {}
