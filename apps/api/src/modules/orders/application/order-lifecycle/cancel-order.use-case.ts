/**
 * `CancelOrderUseCase` (EP-09, DTJ-232, SRS-DOM-090/092/093/154/179, SRS-ORD-029/030/031).
 *
 * Единый вход отмены заказа для клиента и персонала аптеки (`OrderPolicy.canCancel`, DTJ-222,
 * уже спроектирована под ЭТОТ путь — «этот обычный путь» в её JSDoc). Форс-отмена
 * (`fraud_or_safety_force_cancel`/`license_revoked_force_cancel` каскадом по всей аптеке) —
 * отдельный `ForceCancelIncompleteOrdersUseCase` (SRS-DOM-161), вне периметра этого тикета —
 * `OrderPolicy.canCancel` сама отсекает `super_admin`/`courier`/`support_agent` от этого пути.
 *
 * Денежное ветвление (D-25, `21-module-orders-payments-escrow.md` SRS-ORD-029 таблица) — ОДНА
 * точка, `isRefundRequired()` в `OrderCancellationService` (DoD DTJ-232: «ветвление рефанда не дублируется»):
 * наличные (`cash_courier`) НИКОГДА не доходят до `paid_escrow` (D-25) — эскроу для них не
 * создаётся вовсе, `RefundFacadePort` не вызывается ни при какой отмене наличного заказа
 * (D-EP09-29). Non-cash — рефанд ТОЛЬКО если деньги реально были захвачены в эскроу к моменту
 * отмены (`paid_escrow`/`processing`), не из `pending_payment` (там ещё нечего возвращать).
 *
 * `InventoryFacadePort.releaseStock` — ВСЕГДА, независимо от денежной ветки (SRS-ORD-029,
 * D-EP09-30). Идемпотентность двойной отмены обеспечивает `OrderPolicy.canCancel`/машина
 * состояний (DTJ-222): повторный вызов на уже `cancelled` заказе получает `canCancel === false`
 * (статус не входит в `CANCELLABLE_STATUSES`) раньше, чем код доходит до `releaseStock`/рефанда
 * — см. явный тест «двойная отмена» в спеке, не полагаемся на рассуждение (D-EP09-30).
 *
 * Тенант-скоуп (SRS-API-043/046, урок волны 5) — ДВА независимых слоя. `OrderRepositoryPort`
 * принимает `tenantId` первым обязательным параметром (DTJ-227 привёл порт к SRS-API-043,
 * раньше его не было и скоуп держался только на проверке ниже) — чужой тенант не доезжает до
 * application вовсе. Сравнение `order.tenantId !== actor.tenantId` в `findAuthorizedOrder`
 * сохранено намеренно: оно не даёт молча потерять скоуп, если порт когда-нибудь снова начнёт
 * отдавать заказ без фильтра. Чужой тенант и несуществующий заказ дают ОДИНАКОВЫЙ
 * `404 NOT_FOUND` (не `403`) — факт существования заказа в чужом тенанте не подтверждается.
 *
 * Отмена, возврат остатка и `OrderCancelledEvent` в `outbox` — одной транзакцией в
 * `OrderCancellationService`; недоведённый рефанд доводит обработчик события.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import { OrderPolicy, type OrderPolicyActor } from '@/modules/orders/application/policies/order.policy.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { CancelOrderActor, CancelOrderCommand, CancelOrderResult } from './dto/cancel-order-command.dto.js'
import { OrderCancellationService } from './order-cancellation.service.js'

@Injectable()
export class CancelOrderUseCase {
  // eslint-disable-next-line max-params -- конструктор NestJS с DI-инъекциями (явный @Inject на каждой, DTJ-001).
  constructor(
    @Inject(OrdersFacade) private readonly ordersFacade: OrdersFacade,
    @Inject(OrderCancellationService) private readonly cancellation: OrderCancellationService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async execute(cmd: CancelOrderCommand): Promise<CancelOrderResult> {
    await this.findAuthorizedOrder(cmd.orderId, cmd.actor)
    const { refundIssued } = await this.cancellation.cancel({
      tenantId: cmd.actor.tenantId,
      orderId: cmd.orderId,
      reason: cmd.reason,
      actor: { kind: 'user', userId: cmd.actor.userId },
      now: this.clock.now(),
    })
    this.logger.info({ orderId: cmd.orderId, reason: cmd.reason, cancelledBy: cmd.actor.userId, refundIssued }, 'order_cancelled')
    return { orderId: cmd.orderId, status: 'cancelled', refundIssued }
  }

  /** Загрузка + тенант-скоуп + `OrderPolicy` — единая точка проверки доступа (SRS-API-043/046/SRS-ORD-031). */
  private async findAuthorizedOrder(orderId: string, actor: CancelOrderActor): Promise<Order> {
    const order = await this.ordersFacade.getOrderById(actor.tenantId, orderId)
    if (order?.tenantId !== actor.tenantId) {
      // Чужой тенант неотличим от несуществующего заказа снаружи (SRS-API-046) — тот же 404.
      // Эквивалентно `order === null || order.tenantId !== actor.tenantId`: `order?.tenantId`
      // при `order === null` даёт `undefined`, что всегда `!== actor.tenantId` (строка).
      throw new NotFoundError({ resource: 'order', orderId })
    }
    const policyActor: OrderPolicyActor = { role: actor.role, userId: actor.userId, pharmacyId: actor.pharmacyId }
    if (!OrderPolicy.canCancel(order, policyActor)) {
      throw new ForbiddenError('Order cannot be cancelled by this actor in its current state', {
        orderId,
        status: order.status,
      })
    }
    return order
  }

}
