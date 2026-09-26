// Barrel-файл: правится только добавлением строк.
import { Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { CatalogModule } from '@/modules/catalog/catalog.module.js'
import { OnboardingModule } from '@/modules/onboarding/onboarding.module.js'
import { InventoryModule } from '@/modules/inventory/inventory.module.js'
import { ORDERS_FACADE } from '@/modules/orders/index.js'
import { PRODUCT_EVENTS_REPOSITORY_PROVIDER } from './infrastructure/repositories/product-events.repository.js'
import { RecordProductEventUseCase } from './application/use-cases/record-product-event.use-case.js'
import { RecordProductEventsBatchUseCase } from './application/use-cases/record-product-events-batch.use-case.js'
import { RealizedSavingsCalculator } from './application/services/realized-savings-calculator.js'
import { ANALOG_SAVINGS_PORT_PROVIDER } from './infrastructure/adapters/catalog-analog-savings.adapter.js'
import { GetFunnelUseCase } from './application/use-cases/get-funnel.use-case.js'
import { GetPlatformMetricsUseCase } from './application/use-cases/get-platform-metrics.use-case.js'
import { GetTopAnalogsReportUseCase } from './application/use-cases/get-top-analogs-report.use-case.js'
import { GetOnboardingFunnelUseCase } from './application/use-cases/get-onboarding-funnel.use-case.js'
import { ANALYTICS_ORDERS_FACADE_PORT } from './application/ports/orders-facade.port.js'
import { INVENTORY_FACADE_PORT_PROVIDER } from './infrastructure/adapters/inventory-facade.adapter.js'
import { ONBOARDING_FACADE_PORT_PROVIDER } from './infrastructure/adapters/onboarding-facade.adapter.js'
import { AnalyticsFacade } from './analytics.facade.js'
import { AnalyticsEventsController } from './presentation/analytics-events.controller.js'
import { AnalyticsDashboardController } from './presentation/analytics-dashboard.controller.js'
import { AnalyticsReportsController } from './presentation/analytics-reports.controller.js'
import { AnalyticsEventsIdentityGuard } from './presentation/guards/analytics-events-identity.guard.js'

@Module({
  // AuthModule — DTJ-379: AnalyticsEventsIdentityGuard инжектит JWT_SIGNER (экспортирован
  // auth.module.ts), тот же приём, что CartIdentityGuard/orders.module.ts.
  // CatalogModule — DTJ-385: ANALOG_SAVINGS_PORT_PROVIDER инжектит CATALOG_FACADE.
  // OrdersModule НЕ импортирован — он `@Global()`, ORDERS_FACADE доступен без imports (иначе цикл).
  imports: [AuthModule, CatalogModule, OnboardingModule, InventoryModule],
  controllers: [AnalyticsEventsController, AnalyticsDashboardController, AnalyticsReportsController],
  providers: [
    PRODUCT_EVENTS_REPOSITORY_PROVIDER,
    RecordProductEventUseCase,
    RecordProductEventsBatchUseCase,
    RealizedSavingsCalculator,
    ANALOG_SAVINGS_PORT_PROVIDER,
    GetFunnelUseCase,
    AnalyticsEventsIdentityGuard,
    AnalyticsFacade,
    { provide: ANALYTICS_ORDERS_FACADE_PORT, useExisting: ORDERS_FACADE },
    INVENTORY_FACADE_PORT_PROVIDER,
    GetPlatformMetricsUseCase,
    GetTopAnalogsReportUseCase,
    ONBOARDING_FACADE_PORT_PROVIDER,
    GetOnboardingFunnelUseCase,
  ],
  exports: [AnalyticsFacade],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: конфигурация в декораторе.
export class AnalyticsModule {}
