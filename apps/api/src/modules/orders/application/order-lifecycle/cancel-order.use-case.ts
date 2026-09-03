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
 * точка, `isRefundRequired()` внизу файла (DoD DTJ-232: «ветвление рефанда не дублируется»):
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
 * Публикация `OrderCancelledEvent` в `outbox` (payload из глоссария `10-domain-model.md`
 * §«Доменные события») пока идёт через `PINO_LOGGER`, не реальную запись в таблицу `outbox` —
 * тот же приём, что `TenantCacheInvalidationHandler` (DTJ-053): реальная транзакция появится
 * вместе с Drizzle-реализацией `OrderRepositoryPort` (DTJ-227, D-EP09-27), раньше писать в
 * `outbox` было бы «в одной транзакции» только на словах.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { isErr } from '@dorutj/domain-kernel'
import {
  ForbiddenError,
  NotFoundError,
  PaymentProviderUnavailableError,
  type OrderPaymentMethod,
  type OrderStatus,
} from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import { OrderPolicy, type OrderPolicyActor } from '@/modules/orders/application/policies/order.policy.js'
import {
  INVENTORY_FACADE_PORT,
  type InventoryFacadePort,
  type ReleaseStockItemCommand,
} from '@/modules/orders/application/ports/inventory-facade.port.js'
import { REFUND_FACADE_PORT, type RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { CancelOrderActor, CancelOrderCommand, CancelOrderResult } from './dto/cancel-order-command.dto.js'

/** Статусы, из которых деньги (non-cash) реально захвачены в эскроу к моменту отмены (D-25). */
const ESCROW_CAPTURED_STATUSES = new Set<OrderStatus>(['paid_escrow', 'processing'])

@Injectable()
export class CancelOrderUseCase {
  // eslint-disable-next-line max-params -- 3 порта (OrdersFacade/InventoryFacadePort/RefundFacadePort) + Clock + PINO_LOGGER. Явные @Inject-параметры (не фабрика deps-объекта) — тот же приём, что RequestOtpUseCase (auth/application/use-cases/request-otp.use-case.ts), граф зависимостей остаётся видимым в providers[] модуля.
  constructor(
    @Inject(OrdersFacade) private readonly ordersFacade: OrdersFacade,
    // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001,
    // `reports/EP09-CTO-BRIEF.md` §6 урок 1) — без него параметр не резолвится Nest'ом.
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(REFUND_FACADE_PORT) private readonly refundFacade: RefundFacadePort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async execute(cmd: CancelOrderCommand): Promise<CancelOrderResult> {
    const order = await this.findAuthorizedOrder(cmd.orderId, cmd.actor)
    const refundRequired = isRefundRequired(order.status, order.paymentMethod)
    const releaseItems = toReleaseItems(order)

    await this.ordersFacade.cancel(cmd.orderId, {
      tenantId: cmd.actor.tenantId,
      reason: cmd.reason,
      actor: { kind: 'user', userId: cmd.actor.userId },
      now: this.clock.now(),
    })

    // ВСЕГДА, независимо от денежной ветки (SRS-ORD-029, D-EP09-30) — до рефанда: даже если
    // провайдер откажет, склад не должен остаться держать резерв уже отменённого заказа.
    await this.inventoryFacade.releaseStock(releaseItems)
    if (refundRequired) {
      await this.refundOrThrow(cmd.orderId, cmd.reason)
    }

    this.logOrderCancelled(cmd, refundRequired)
    return { orderId: cmd.orderId, status: 'cancelled', refundIssued: refundRequired }
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

  private async refundOrThrow(orderId: string, reason: CancelOrderCommand['reason']): Promise<void> {
    const result = await this.refundFacade.refundFull(orderId, reason)
    if (isErr(result)) {
      throw new PaymentProviderUnavailableError({ orderId, cause: result.error })
    }
  }

  /** TODO(DTJ-227): заменить на реальную запись в `outbox` (см. JSDoc файла) — до тех пор best-effort лог. */
  private logOrderCancelled(cmd: CancelOrderCommand, refundIssued: boolean): void {
    this.logger.info(
      { orderId: cmd.orderId, reason: cmd.reason, cancelledBy: cmd.actor.userId, refundIssued },
      'order_cancelled',
    )
  }
}

/** D-25/D-EP09-29 — единственная точка решения «нужен ли рефанд» (DoD: не дублируется). */
function isRefundRequired(preStatus: OrderStatus, paymentMethod: OrderPaymentMethod): boolean {
  if (paymentMethod === 'cash_courier') {
    return false
  }
  return ESCROW_CAPTURED_STATUSES.has(preStatus)
}

function toReleaseItems(order: Order): readonly ReleaseStockItemCommand[] {
  return order.items.map((item) => ({ inventoryBatchId: item.inventoryBatchId, quantity: item.quantity }))
}
