/**
 * `AcceptOrderUseCase` (DTJ-301, EP-12, модуль 24 «Терминал фармацевта», SRS-PHT-007/008/009) —
 * `POST /api/v1/orders/:id/accept`. Момент, запускающий SLA-таймер сборки и переводящий заказ
 * `paid_escrow`/`confirmed → processing` (SRS-DOM-091/178).
 *
 * Атомарность (TC-PHT-002/023) — ОДНА транзакция (`OrdersUnitOfWorkPort.run`), внутри которой:
 * (1) `SELECT ... FOR UPDATE` на строку `orders` (`findByIdForUpdate` — сериализует конкурентные
 * `accept` РЕАЛЬНОЙ блокировкой строки, не оптимистичным `UPDATE ... WHERE`, в отличие от `claim`
 * модуля `delivery` — см. технический контекст тикета); (2) проверка гонки «уже принят»
 * ПЕРЕД `OrderPolicy.canAccept` (см. ниже, почему порядок важен); (3) `order.startProcessing(...)`
 * (существующий доменный метод, DTJ-222); (4) `orders.assigned_pharmacist_id` — точечный
 * `UPDATE`, поле вне домена (DTJ-300, `[РАСШИРЕНИЕ]`, см. JSDoc `order-repository.port.ts`);
 * (5) `OrderProcessingStartedEvent` (существующее, эмитируется `startProcessing()` САМ) И
 * `OrderClaimedEvent` (`[РАСШИРЕНИЕ]` DTJ-300, конструируется ЗДЕСЬ — `Order` не может сам его
 * эмитировать, поле `assignedPharmacistId` ему не принадлежит) — ОБА в ОДНОЙ записи `outbox`
 * (`OrdersOutboxPort.appendAll`, СТРОГО в той же `tx`, SRS-DOM-151).
 *
 * **Порядок проверок «уже принят» ДО `OrderPolicy.canAccept`** — к моменту, когда
 * `assignedPharmacistId !== null`, заказ уже `processing` (accept ВСЕГДА выставляет оба поля
 * атомарно) — `canAccept` тоже вернул бы `false` (статус не `paid_escrow`/`confirmed`), но с
 * менее специфичной `403 Forbidden` вместо требуемой SRS-PHT-009 `409 ORDER_ALREADY_CLAIMED`
 * с `details.assignedPharmacistId/assignedPharmacistName/claimedAt`.
 *
 * `Idempotency-Key` — HTTP-слой (`@Idempotent()` на контроллере, `IdempotencyInterceptor`),
 * этот use case её не знает (тот же приём, что `RetryPaymentUseCase`/`CancelOrderUseCase` —
 * НЕ `CheckoutUseCase`, которому нужен ВТОРОЙ, application-уровневый слой из-за нескольких групп
 * за один вызов, см. её JSDoc — здесь один заказ, один вызов, этого не требуется).
 */
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError, type UserRole } from '@dorutj/contracts'
import { OrderAlreadyClaimedError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { ORDERS_UNIT_OF_WORK, type OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import { ORDERS_OUTBOX, type OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import { INVENTORY_FACADE_PORT, type InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import { TENANCY_FACADE_PORT, type TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import { OrderPolicy, type OrderPolicyActor } from '@/modules/orders/application/policies/order.policy.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { OrderDomainEvent } from '@/modules/orders/domain/order-domain-event.js'

const MS_PER_MINUTE = 60_000

export interface AcceptOrderActor {
  readonly userId: string
  readonly role: UserRole
  readonly tenantId: string
  readonly pharmacyId: string | null
}

export interface AcceptOrderCommand {
  readonly orderId: string
  readonly actor: AcceptOrderActor
}

export interface AcceptOrderResult {
  readonly orderId: string
  readonly status: 'processing'
  readonly slaDeadlineAt: Date
  readonly assignedPharmacistId: string
}

@Injectable()
export class AcceptOrderUseCase {
  // eslint-disable-next-line max-params -- 5 портов + Clock, тот же приём, что CancelOrderUseCase (явные @Inject, граф виден в providers[]).
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(ORDERS_OUTBOX) private readonly ordersOutbox: OrdersOutboxPort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(cmd: AcceptOrderCommand): Promise<AcceptOrderResult> {
    return this.unitOfWork.run(async (tx) => {
      const locked = await this.orderRepository.findByIdForUpdate(cmd.actor.tenantId, cmd.orderId, tx)
      if (locked === null) {
        throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
      }
      const { order, assignedPharmacistId } = locked
      if (assignedPharmacistId !== null) {
        throw await this.buildAlreadyClaimedError(order, assignedPharmacistId)
      }
      this.assertCanAccept(order, cmd.actor)

      const now = this.clock.now()
      const pickupSlaMinutes = await this.tenancyFacade.getPickupSlaMinutes(cmd.actor.tenantId)
      const slaDeadlineAt = addMinutes(now, pickupSlaMinutes)
      const hasExpiredReservedBatch = await this.inventoryFacade.hasExpiredReservedBatch(cmd.orderId)

      order.startProcessing({ pharmacistId: cmd.actor.userId, slaDeadlineAt, hasExpiredReservedBatch }, now)
      await this.orderRepository.save(order, tx)
      await this.orderRepository.setAssignedPharmacist(cmd.orderId, cmd.actor.userId, tx)

      const claimedEvent: OrderDomainEvent = {
        type: 'OrderClaimedEvent',
        orderId: cmd.orderId,
        pharmacistId: cmd.actor.userId,
        claimedAt: now,
      }
      await this.ordersOutbox.appendAll(cmd.actor.tenantId, [...order.pullDomainEvents(), claimedEvent], tx)

      return { orderId: cmd.orderId, status: 'processing', slaDeadlineAt, assignedPharmacistId: cmd.actor.userId }
    })
  }

  /** SRS-PHT-007 — `OrderPolicy.canAccept` (роль+аптека+статус); своя аптека vs другая различает ошибку. */
  private assertCanAccept(order: Order, actor: AcceptOrderActor): void {
    const policyActor: OrderPolicyActor = { role: actor.role, userId: actor.userId, pharmacyId: actor.pharmacyId }
    if (OrderPolicy.canAccept(order, policyActor)) return
    throw new ForbiddenError('Order cannot be accepted by this actor in its current state', {
      orderId: order.id,
      status: order.status,
    })
  }

  /** SRS-PHT-009 — `assignedPharmacistName` best-effort (см. JSDoc порта), `claimedAt = processingStartedAt`. */
  private async buildAlreadyClaimedError(order: Order, assignedPharmacistId: string): Promise<OrderAlreadyClaimedError> {
    const assignedPharmacistName = await this.orderRepository.findAssignedPharmacistName(assignedPharmacistId)
    const claimedAt = order.toSnapshot().processingStartedAt
    return new OrderAlreadyClaimedError({
      assignedPharmacistId,
      assignedPharmacistName,
      claimedAt: claimedAt === null ? null : claimedAt.toISOString(),
    })
  }
}

/** Application-слой, не domain (`02` §2.6 запрещает `Date`-арифметику только в domain) — 1:1 приём `checkout.util.ts`. */
function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE)
}
