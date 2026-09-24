// Barrel-файл: правится только добавлением строк.
import { Module } from '@nestjs/common'
import { PRODUCT_EVENTS_REPOSITORY_PROVIDER } from './infrastructure/repositories/product-events.repository.js'
import { RecordProductEventUseCase } from './application/use-cases/record-product-event.use-case.js'
import { RealizedSavingsCalculator } from './application/services/realized-savings-calculator.js'
import { AnalyticsFacade } from './analytics.facade.js'

@Module({
  providers: [PRODUCT_EVENTS_REPOSITORY_PROVIDER, RecordProductEventUseCase, RealizedSavingsCalculator, AnalyticsFacade],
  exports: [AnalyticsFacade],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: конфигурация в декораторе.
export class AnalyticsModule {}
