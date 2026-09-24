/**
 * `DeliveryFacadeAdapter` (EP-13, DTJ-314/320/321) — реализация `DeliveryFacadePort`
 * (`application/ports/delivery-facade.port.js`, DTJ-220) поверх реального `modules/delivery`
 * → `DeliveryFacade` (публичный фасад, `@/modules/delivery/index.js`, `02` §1.2). Заменяет
 * `UnimplementedDeliveryFacadeAdapter` в биндинге `DELIVERY_FACADE_PORT` (`orders.module.ts`) —
 * тот же приём, что `OrdersFacadeAdapter` снял `OrdersReadOnlyAdapter`/`UnimplementedRefundFacade
 * Adapter` (DTJ-242/245).
 *
 * `calculateFee` -> `DeliveryFacade.calculateDeliveryFee` — тонкая делегация, имена методов
 * расходятся (порт объявлен DTJ-220 раньше модуля `delivery`), сигнатуры совпадают 1:1.
 * `DeliveryFacade.calculateDeliveryFee` сама по себе ЗАГЛУШКА (см. её JSDoc, `DTJ-322`) — этот
 * адаптер не добавляет и не снимает это ограничение, только резолвит DI на настоящий модуль
 * вместо `UnimplementedDeliveryFacadeAdapter`. `resolveDeliveryFee` (`CalculateOrderCostService`)
 * короtит на `pharmacyGeoPoint === null` до вызова порта (foundIssue, тот же файл) — сегодня в
 * проде этот адаптер ещё не вызывается ни одним путём, вызов станет реальным, когда
 * `OnboardingFacadePort` начнёт нести геоточку аптеки.
 */
import { Inject, Injectable } from '@nestjs/common'
import { DeliveryFacade } from '@/modules/delivery/index.js'
import type { GeoPoint } from '@/shared-kernel/index.js'
import type { DeliveryFacadePort } from '@/modules/orders/application/ports/delivery-facade.port.js'

@Injectable()
export class DeliveryFacadeAdapter implements DeliveryFacadePort {
  public constructor(@Inject(DeliveryFacade) private readonly delivery: DeliveryFacade) {}

  public async calculateFee(pharmacyGeoPoint: GeoPoint, deliveryGeoPoint: GeoPoint): Promise<bigint> {
    return this.delivery.calculateDeliveryFee(pharmacyGeoPoint, deliveryGeoPoint)
  }
}
