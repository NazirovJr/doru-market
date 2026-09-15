/**
 * `UnimplementedReturnsDeliveryAdapter` (EP-11, DTJ-273) — NullAdapter, правило 15 AGENTS.md,
 * `TODO(EP-13)`. 1:1 приём, что `UnimplementedDeliveryFacadeAdapter` (`orders.module.ts`, DTJ-228):
 * модуль `delivery` (EP-13) на момент этого тикета содержит ТОЛЬКО domain-слой (координатор,
 * `docs/STATE-AND-RESUME-POINT.md` §13.21) — ни use case'ов, ни публичного фасада нет.
 *
 * Существует ТОЛЬКО чтобы `RETURNS_DELIVERY_PORT` резолвился Nest'ом (иначе `RequestReturnUseCase`/
 * `MarkReturnInTransitUseCase`/`RetryReturnTransitUseCase` не собираются) — бросает, не
 * «правдоподобный 0»: заниженная/нулевая курьерская компенсация — денежная ошибка (правило 6
 * AGENTS.md), молчаливый `null` для `assignReturnCourier` был бы неотличим от «курьер временно
 * недоступен» (легитимный best-effort исход, JSDoc use case) от «порт не подключён» (баг среды).
 */
import type { ReturnsCourierAssignment, ReturnsDeliveryPort } from '@/modules/returns/application/ports/delivery-facade.port.js'

export class UnimplementedReturnsDeliveryAdapter implements ReturnsDeliveryPort {
  assignReturnCourier(): Promise<ReturnsCourierAssignment | null> {
    return Promise.reject(
      new Error('ReturnsDeliveryPort.assignReturnCourier() has no implementation yet — TODO(EP-13): bind a real adapter.'),
    )
  }

  calculateReturnFee(): Promise<bigint> {
    return Promise.reject(
      new Error('ReturnsDeliveryPort.calculateReturnFee() has no implementation yet — TODO(EP-13): bind a real adapter.'),
    )
  }
}
