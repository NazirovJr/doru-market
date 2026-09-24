/**
 * `DeliveryOrdersAdapter` (EP-13, DTJ-321) — реализация `DeliveryOrdersPort` поверх реального
 * `modules/orders` → `OrdersFacade` (`application/orders.facade.ts`, EP-09, DTJ-222). 1:1 паттерн
 * `payments/infrastructure/adapters/orders-facade.adapter.ts` (DTJ-242) — см. её JSDoc для
 * полного разбора DI-цикла ниже, тут — сокращённая версия (только вывод, применённый к `delivery`).
 *
 * DI-ЦИКЛ: `orders.module.ts` — `@Global()` (решение DTJ-242, см. её JSDoc в `orders.module.ts`
 * «РЕШЕНО (DTJ-242)»): `ORDERS_FACADE`/`OrdersFacade` видны `delivery.module.ts` БЕЗ
 * `imports: [OrdersModule]` и БЕЗ единого нового статического импорта `orders.module.ts` —
 * ЭТОТ файл импортирует ТОЛЬКО `@/modules/orders/index.js` (публичный фасад, `02` §1.2), никогда
 * `orders.module.ts` — цикл `orders.module.ts → delivery.module.ts → orders.module.ts`
 * физически невозможен (`orders` не импортирует `delivery` нигде на момент этого файла).
 *
 * READ-ONLY: в отличие от `OrdersFacadeAdapter` (payments), этому адаптеру не нужна ветка
 * `SELECT ... FOR UPDATE` — `SubmitCourierRatingUseCase` не мутирует `orders`, а
 * `UNIQUE(courier_ratings.order_id)` — единственный реальный барьер от гонки дублирующей оценки
 * (тот же риск-профиль, что `ux_courier_shifts_one_active`, см. JSDoc `StartCourierShiftUseCase`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { ORDERS_FACADE, type OrdersFacade } from '@/modules/orders/index.js'
import {
  DELIVERY_ORDERS_PORT,
  type DeliveryOrdersPort,
  type OrderRatingContext,
} from '@/modules/delivery/application/ports/delivery-orders.port.js'

@Injectable()
export class DeliveryOrdersAdapter implements DeliveryOrdersPort {
  public constructor(@Inject(ORDERS_FACADE) private readonly ordersFacade: OrdersFacade) {}

  public async getOrderForRating(tenantId: string, orderId: string): Promise<OrderRatingContext | null> {
    const order = await this.ordersFacade.getOrderById(tenantId, orderId)
    if (order === null) {
      return null
    }
    return { orderId: order.id, customerId: order.customerId, status: order.status }
  }
}

export const DELIVERY_ORDERS_PORT_PROVIDER = {
  provide: DELIVERY_ORDERS_PORT,
  useClass: DeliveryOrdersAdapter,
} as const
