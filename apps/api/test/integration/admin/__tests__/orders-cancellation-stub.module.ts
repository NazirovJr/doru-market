import { Global, Module } from '@nestjs/common'
import { PHARMACY_ORDERS_CANCELLATION } from '@/modules/orders/index.js'

/** Харнессы без `OrdersModule` поднимают `OnboardingModule`, которому нужен порт отмены заказов; их сценарии его не вызывают. */
@Global()
@Module({
  providers: [
    {
      provide: PHARMACY_ORDERS_CANCELLATION,
      useValue: { execute: () => Promise.reject(new Error('orders cancellation is not part of this harness')) },
    },
  ],
  exports: [PHARMACY_ORDERS_CANCELLATION],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- модуль тест-харнесса
export class OrdersCancellationStubModule {}
