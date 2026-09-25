import { Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/index.js'
import { TenancyModule } from '@/modules/tenancy/tenancy.module.js'
import { CatalogModule } from '@/modules/catalog/catalog.module.js'
import { DeliveryFacade } from './application/delivery.facade.js'
import { SuggestNearestCourierUseCase } from './application/use-cases/suggest-nearest-courier.use-case.js'
import { StartCourierShiftUseCase } from './application/use-cases/start-courier-shift.use-case.js'
import { EndCourierShiftUseCase } from './application/use-cases/end-courier-shift.use-case.js'
import { SubmitCourierRatingUseCase } from './application/use-cases/submit-courier-rating.use-case.js'
import { GetCourierEarningsUseCase } from './application/use-cases/get-courier-earnings.use-case.js'
import { GetCourierPayoutsUseCase } from './application/use-cases/get-courier-payouts.use-case.js'
import { CreateDeliveryAssignmentUseCase } from './application/use-cases/create-delivery-assignment.use-case.js'
import { AcceptDeliveryOfferUseCase } from './application/use-cases/accept-delivery-offer.use-case.js'
import { DeclineDeliveryOfferUseCase } from './application/use-cases/decline-delivery-offer.use-case.js'
import { ResolveDeliveryOfferTimeoutUseCase } from './application/use-cases/resolve-delivery-offer-timeout.use-case.js'
import { GetPendingDeliveryOffersUseCase } from './application/use-cases/get-pending-delivery-offers.use-case.js'
import { BuildCourierCandidateQueryService } from './application/services/build-courier-candidate-query.service.js'
import { EscalateDeliveryOfferService } from './application/services/escalate-delivery-offer.service.js'
import { CalculateDeliveryFeeUseCase } from './application/use-cases/calculate-delivery-fee.use-case.js'
import { ManageDeliveryZonesUseCase } from './application/use-cases/manage-delivery-zones.use-case.js'
import { ManageDeliveryPricingRulesUseCase } from './application/use-cases/manage-delivery-pricing-rules.use-case.js'
import { COURIER_REPOSITORY_PROVIDER } from './infrastructure/repositories/courier.repository.js'
import { DELIVERY_ZONE_REPOSITORY_PROVIDER } from './infrastructure/repositories/delivery-zone.repository.js'
import { DELIVERY_PRICING_RULE_REPOSITORY_PROVIDER } from './infrastructure/repositories/delivery-pricing-rule.repository.js'
import { DELIVERY_ASSIGNMENT_REPOSITORY_PROVIDER } from './infrastructure/repositories/delivery-assignment.repository.js'
import { DELIVERY_OFFER_REPOSITORY_PROVIDER } from './infrastructure/repositories/delivery-offer.repository.js'
import { COURIER_SHIFT_REPOSITORY_PROVIDER } from './infrastructure/repositories/courier-shift.repository.js'
import { COURIER_RATING_REPOSITORY_PROVIDER } from './infrastructure/repositories/courier-rating.repository.js'
import { COURIER_EARNINGS_REPOSITORY_PROVIDER } from './infrastructure/repositories/courier-earnings.repository.js'
import { COURIER_PAYOUTS_REPOSITORY_PROVIDER } from './infrastructure/repositories/courier-payouts.repository.js'
import { COURIER_CANDIDATE_PORT_PROVIDER } from './infrastructure/adapters/postgis-courier-candidate.adapter.js'
import { DELIVERY_TENANCY_PORT_PROVIDER } from './infrastructure/adapters/delivery-tenancy.adapter.js'
import { DELIVERY_OUTBOX_PROVIDER } from './infrastructure/adapters/delivery-outbox.adapter.js'
import { DELIVERY_ORDERS_PORT_PROVIDER } from './infrastructure/adapters/delivery-orders.adapter.js'
import { PHARMACY_LOOKUP_PORT_PROVIDER } from './infrastructure/adapters/pharmacy-lookup.adapter.js'
import { DELIVERY_CANDIDATE_CACHE_PORT_PROVIDER } from './infrastructure/adapters/redis-delivery-candidate-cache.adapter.js'
import { DELIVERY_OFFER_TIMEOUT_QUEUE_PROVIDER } from './infrastructure/jobs/delivery-offer-timeout.processor.js'
import { DELIVERY_UNIT_OF_WORK_PROVIDER } from './infrastructure/drizzle-delivery-unit-of-work.adapter.js'
import { OrderPickedUpEventHandler } from './infrastructure/event-handlers/order-picked-up.handler.js'
import { CourierShiftsController } from './presentation/courier-shifts.controller.js'
import { CourierEarningsController } from './presentation/courier-earnings.controller.js'
import { CourierPayoutsController } from './presentation/courier-payouts.controller.js'
import { CourierRatingsController } from './presentation/courier-ratings.controller.js'
import { DeliveryOffersController } from './presentation/delivery-offers.controller.js'
import { DeliveryOfferTimeoutController } from './presentation/internal/delivery-offer-timeout.controller.js'
import { DeliveryPricingController } from './presentation/delivery-pricing.controller.js'
import { DeliveryZonesController } from './presentation/delivery-zones.controller.js'

@Module({
  imports: [AuthModule, TenancyModule, CatalogModule],
  controllers: [
    CourierShiftsController,
    CourierEarningsController,
    CourierPayoutsController,
    CourierRatingsController,
    DeliveryOffersController,
    DeliveryOfferTimeoutController,
    DeliveryPricingController,
    DeliveryZonesController,
  ],
  providers: [
    COURIER_REPOSITORY_PROVIDER,
    DELIVERY_ASSIGNMENT_REPOSITORY_PROVIDER,
    DELIVERY_OFFER_REPOSITORY_PROVIDER,
    COURIER_SHIFT_REPOSITORY_PROVIDER,
    COURIER_RATING_REPOSITORY_PROVIDER,
    COURIER_EARNINGS_REPOSITORY_PROVIDER,
    COURIER_PAYOUTS_REPOSITORY_PROVIDER,
    COURIER_CANDIDATE_PORT_PROVIDER,
    DELIVERY_TENANCY_PORT_PROVIDER,
    DELIVERY_OUTBOX_PROVIDER,
    DELIVERY_ORDERS_PORT_PROVIDER,
    PHARMACY_LOOKUP_PORT_PROVIDER,
    DELIVERY_CANDIDATE_CACHE_PORT_PROVIDER,
    DELIVERY_OFFER_TIMEOUT_QUEUE_PROVIDER,
    DELIVERY_UNIT_OF_WORK_PROVIDER,
    DELIVERY_ZONE_REPOSITORY_PROVIDER,
    DELIVERY_PRICING_RULE_REPOSITORY_PROVIDER,
    SuggestNearestCourierUseCase,
    StartCourierShiftUseCase,
    EndCourierShiftUseCase,
    SubmitCourierRatingUseCase,
    GetCourierEarningsUseCase,
    GetCourierPayoutsUseCase,
    BuildCourierCandidateQueryService,
    EscalateDeliveryOfferService,
    CreateDeliveryAssignmentUseCase,
    AcceptDeliveryOfferUseCase,
    DeclineDeliveryOfferUseCase,
    ResolveDeliveryOfferTimeoutUseCase,
    GetPendingDeliveryOffersUseCase,
    OrderPickedUpEventHandler,
    CalculateDeliveryFeeUseCase,
    ManageDeliveryZonesUseCase,
    ManageDeliveryPricingRulesUseCase,
    DeliveryFacade,
  ],
  exports: [DeliveryFacade],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module marker class
export class DeliveryModule {}
