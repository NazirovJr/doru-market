/**
 * NestJS-модуль `delivery` (EP-13). Barrel-файл (D-27): правится ТОЛЬКО добавлением строк,
 * перечитать перед правкой, конфликты слияния — за архитектором.
 *
 * DTJ-313 завела ЧИСТЫЙ `domain/` (ноль `@nestjs/*`-импортов, `02` §2.6) — не требовала правки
 * этого файла (он не существовал). DTJ-314 создаёт `application/`/`infrastructure/` ВПЕРВЕ:
 * `DeliveryFacade`, `SuggestNearestCourierUseCase`, репозитории `Courier`/`DeliveryAssignment`,
 * `CourierCandidatePort`/`DeliveryTenancyPort`-адаптеры. DTJ-320 добавляет смены курьера
 * (`Start`/`EndCourierShiftUseCase`, `CourierShiftsController`). DTJ-321 добавляет заработок/
 * выплаты/рейтинг (read-эндпоинты `courier-earnings`/`courier-payouts` + `POST /courier-ratings`).
 *
 * `TenancyModule` — импортирован ради `TENANT_REPOSITORY` (`DeliveryTenancyAdapter`, DTJ-314),
 * тот же приём, что `orders.module.ts` (DTJ-228/229) импортирует его ради `TENANT_SETTINGS_
 * REPOSITORY`. `OrdersModule` НЕ импортируется (DTJ-321, `DeliveryOrdersAdapter`) — `orders.
 * module.ts` уже `@Global()` (решение DTJ-242), `ORDERS_FACADE` виден без `imports:`, см. JSDoc
 * `delivery-orders.adapter.ts`. `AuthModule` — ДОБАВЛЕНО (DTJ-321, обнаружено `app.module.spec.ts`
 * «поднимается целиком», Ж2): `CourierShiftsController`/`CourierEarningsController`/
 * `CourierPayoutsController`/`CourierRatingsController` — все под `@UseGuards(AuthGuard,
 * RolesGuard)`, `AuthGuard` инжектит `JWT_SIGNER` — без явного `imports: [AuthModule]` DI-граф
 * не резолвится ни для одного контроллера этого модуля (foundIssue: `CourierShiftsController`,
 * DTJ-320, уже требовал этого ДО DTJ-321 — этот модуль, похоже, ни разу не поднимался целиком до
 * этой правки, см. отчёт сдачи). 1:1 приём `payments.module.ts` (`AuthModule` импортирует только
 * `@Global()`-модули — цикла нет).
 */
import { Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/index.js'
import { TenancyModule } from '@/modules/tenancy/tenancy.module.js'
import { DeliveryFacade } from './application/delivery.facade.js'
import { SuggestNearestCourierUseCase } from './application/use-cases/suggest-nearest-courier.use-case.js'
import { StartCourierShiftUseCase } from './application/use-cases/start-courier-shift.use-case.js'
import { EndCourierShiftUseCase } from './application/use-cases/end-courier-shift.use-case.js'
import { SubmitCourierRatingUseCase } from './application/use-cases/submit-courier-rating.use-case.js'
import { GetCourierEarningsUseCase } from './application/use-cases/get-courier-earnings.use-case.js'
import { GetCourierPayoutsUseCase } from './application/use-cases/get-courier-payouts.use-case.js'
import { COURIER_REPOSITORY_PROVIDER } from './infrastructure/repositories/courier.repository.js'
import { DELIVERY_ASSIGNMENT_REPOSITORY_PROVIDER } from './infrastructure/repositories/delivery-assignment.repository.js'
import { COURIER_SHIFT_REPOSITORY_PROVIDER } from './infrastructure/repositories/courier-shift.repository.js'
import { COURIER_RATING_REPOSITORY_PROVIDER } from './infrastructure/repositories/courier-rating.repository.js'
import { COURIER_EARNINGS_REPOSITORY_PROVIDER } from './infrastructure/repositories/courier-earnings.repository.js'
import { COURIER_PAYOUTS_REPOSITORY_PROVIDER } from './infrastructure/repositories/courier-payouts.repository.js'
import { COURIER_CANDIDATE_PORT_PROVIDER } from './infrastructure/adapters/postgis-courier-candidate.adapter.js'
import { DELIVERY_TENANCY_PORT_PROVIDER } from './infrastructure/adapters/delivery-tenancy.adapter.js'
import { DELIVERY_OUTBOX_PROVIDER } from './infrastructure/adapters/delivery-outbox.adapter.js'
import { DELIVERY_ORDERS_PORT_PROVIDER } from './infrastructure/adapters/delivery-orders.adapter.js'
import { DELIVERY_UNIT_OF_WORK_PROVIDER } from './infrastructure/drizzle-delivery-unit-of-work.adapter.js'
import { CourierShiftsController } from './presentation/courier-shifts.controller.js'
import { CourierEarningsController } from './presentation/courier-earnings.controller.js'
import { CourierPayoutsController } from './presentation/courier-payouts.controller.js'
import { CourierRatingsController } from './presentation/courier-ratings.controller.js'

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [CourierShiftsController, CourierEarningsController, CourierPayoutsController, CourierRatingsController],
  providers: [
    COURIER_REPOSITORY_PROVIDER,
    DELIVERY_ASSIGNMENT_REPOSITORY_PROVIDER,
    COURIER_SHIFT_REPOSITORY_PROVIDER,
    COURIER_RATING_REPOSITORY_PROVIDER,
    COURIER_EARNINGS_REPOSITORY_PROVIDER,
    COURIER_PAYOUTS_REPOSITORY_PROVIDER,
    COURIER_CANDIDATE_PORT_PROVIDER,
    DELIVERY_TENANCY_PORT_PROVIDER,
    DELIVERY_OUTBOX_PROVIDER,
    DELIVERY_ORDERS_PORT_PROVIDER,
    DELIVERY_UNIT_OF_WORK_PROVIDER,
    SuggestNearestCourierUseCase,
    StartCourierShiftUseCase,
    EndCourierShiftUseCase,
    SubmitCourierRatingUseCase,
    GetCourierEarningsUseCase,
    GetCourierPayoutsUseCase,
    DeliveryFacade,
  ],
  exports: [DeliveryFacade],
})
// NestJS module marker class — providers регистрируются декоратором, не телом класса (тот же
// приём, что modules/support/payments/orders).
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module marker class, см. комментарий выше
export class DeliveryModule {}
