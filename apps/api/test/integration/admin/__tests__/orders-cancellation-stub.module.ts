import { Global, Module } from '@nestjs/common'
import { PHARMACY_ORDERS_CANCELLATION } from '@/modules/orders/index.js'

export const ORDERS_CANCELLATION_STUB_CALLS: { pharmacyId: string; scope: string }[] = []

/** Харнессы без `OrdersModule` поднимают `OnboardingModule`, которому нужен порт отмены заказов: заглушка ничего не отменяет и запоминает вызовы. */
@Global()
@Module({
  providers: [
    {
      provide: PHARMACY_ORDERS_CANCELLATION,
      useValue: {
        execute: (pharmacyId: string, scope = 'all') => {
          ORDERS_CANCELLATION_STUB_CALLS.push({ pharmacyId, scope })
          return Promise.resolve({ cancelledOrderIds: [], failedOrderIds: [] })
        },
      },
    },
  ],
  exports: [PHARMACY_ORDERS_CANCELLATION],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- модуль тест-харнесса
export class OrdersCancellationStubModule {}
