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
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module marker class
export class DeliveryModule {}
