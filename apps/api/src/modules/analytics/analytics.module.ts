// Barrel-файл: правится только добавлением строк.
import { Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { CatalogModule } from '@/modules/catalog/catalog.module.js'
import { PRODUCT_EVENTS_REPOSITORY_PROVIDER } from './infrastructure/repositories/product-events.repository.js'
import { RecordProductEventUseCase } from './application/use-cases/record-product-event.use-case.js'
import { RecordProductEventsBatchUseCase } from './application/use-cases/record-product-events-batch.use-case.js'
import { RealizedSavingsCalculator } from './application/services/realized-savings-calculator.js'
import { ANALOG_SAVINGS_PORT_PROVIDER } from './infrastructure/adapters/catalog-analog-savings.adapter.js'
import { AnalyticsFacade } from './analytics.facade.js'
import { AnalyticsEventsController } from './presentation/analytics-events.controller.js'
import { AnalyticsEventsIdentityGuard } from './presentation/guards/analytics-events-identity.guard.js'

@Module({
  // AuthModule — DTJ-379: AnalyticsEventsIdentityGuard инжектит JWT_SIGNER (экспортирован
  // auth.module.ts), тот же приём, что CartIdentityGuard/orders.module.ts.
  // CatalogModule — DTJ-385: ANALOG_SAVINGS_PORT_PROVIDER инжектит CATALOG_FACADE.
  imports: [AuthModule, CatalogModule],
  controllers: [AnalyticsEventsController],
  providers: [
    PRODUCT_EVENTS_REPOSITORY_PROVIDER,
    RecordProductEventUseCase,
    RecordProductEventsBatchUseCase,
    RealizedSavingsCalculator,
    ANALOG_SAVINGS_PORT_PROVIDER,
    AnalyticsEventsIdentityGuard,
    AnalyticsFacade,
  ],
  exports: [AnalyticsFacade],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: конфигурация в декораторе.
export class AnalyticsModule {}
