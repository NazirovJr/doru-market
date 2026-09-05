/**
 * `ReclaimOrderUseCase` (DTJ-301, EP-12, модуль 24 «Терминал фармацевта», SRS-PHT-010) —
 * `POST /api/v1/orders/:id/reclaim`. «Перехват» заказа у коллеги (например, A отошёл от
 * терминала посреди сборки) — доступен ЛЮБОМУ `pharmacist`/`pharmacy_admin` ТОЙ ЖЕ аптеки, НЕ
 * обязательно текущему держателю (RBAC-скоуп `pharmacy` — блокировка «кто ведёт сборку» ЧИСТО
 * UX-механизм, SRS-PHT-038, не мера безопасности).
 *
 * Обновляет ТОЛЬКО `orders.assigned_pharmacist_id` — НЕ трогает `sla_deadline_at` (таймер общий
 * для аптеки, не для сотрудника) и НЕ сбрасывает прогресс сканирования позиций (`order_items`
 * не читаются/не пишутся этим use case вовсе). `Order` (домен) НЕ мутируется — заказ уже
 * `processing`, состояние машины переходов не меняется, `startProcessing()`/другие
 * методы-намерения здесь не вызываются.
 *
 * `SELECT ... FOR UPDATE` (та же блокировка строки, что `AcceptOrderUseCase`, `findByIdForUpdate`)
 * — защита от гонки reclaim/reclaim и reclaim/accept на ОДНОМ заказе, хотя тикет явно требует
 * REAL-конкурентный тест (TC-PHT-023) только для `accept`.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { ForbiddenError, NotFoundError, type UserRole } from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { ORDERS_UNIT_OF_WORK, type OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import { ORDERS_OUTBOX, type OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import { OrderPolicy, type OrderPolicyActor } from '@/modules/orders/application/policies/order.policy.js'
import type { OrderDomainEvent, OrderReclaimReason } from '@/modules/orders/domain/order-domain-event.js'

export interface ReclaimOrderActor {
  readonly userId: string
  readonly role: UserRole
  readonly tenantId: string
  readonly pharmacyId: string | null
}

export interface ReclaimOrderCommand {
  readonly orderId: string
  readonly actor: ReclaimOrderActor
  readonly reason: OrderReclaimReason
  /** Необязательный комментарий (тело запроса, SRS-PHT-010) — нет выделенной колонки аудита
   *  (DTJ-300 scaffolding её не заводил), best-effort пишется в структурный лог (см. JSDoc файла
   *  `CancelOrderUseCase` — тот же временный приём, TODO(DTJ-227) там же). */
  readonly note?: string
}

export interface ReclaimOrderResult {
  readonly orderId: string
  readonly assignedPharmacistId: string
  readonly slaDeadlineAt: Date | null
}

@Injectable()
export class ReclaimOrderUseCase {
  // eslint-disable-next-line max-params -- 3 порта (OrderRepositoryPort/OrdersUnitOfWorkPort/OrdersOutboxPort) + Clock + PINO_LOGGER, тот же приём, что CancelOrderUseCase (явные @Inject-параметры, граф зависимостей виден в providers[] модуля).
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(ORDERS_OUTBOX) private readonly ordersOutbox: OrdersOutboxPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async execute(cmd: ReclaimOrderCommand): Promise<ReclaimOrderResult> {
    return this.unitOfWork.run(async (tx) => {
      const locked = await this.orderRepository.findByIdForUpdate(cmd.actor.tenantId, cmd.orderId, tx)
      if (locked === null) {
        throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
      }
      const { order, assignedPharmacistId: previousPharmacistId } = locked
      const policyActor: OrderPolicyActor = { role: cmd.actor.role, userId: cmd.actor.userId, pharmacyId: cmd.actor.pharmacyId }
      if (!OrderPolicy.canReclaim(order, policyActor)) {
        throw new ForbiddenError('Order cannot be reclaimed by this actor in its current state', {
          orderId: cmd.orderId,
          status: order.status,
        })
      }
      if (previousPharmacistId === null) {
        // SRS-PHT-038/DOM-091 — `processing` достижим ТОЛЬКО через `accept`, который ВСЕГДА
        // выставляет `assigned_pharmacist_id` атомарно (см. JSDoc `AcceptOrderUseCase`). `null`
        // здесь — испорченные данные, не пользовательский ввод: та же защита, что `rowToSnapshot`
        // (`order.repository.ts`) — падает громко (`Error`, НЕ `DomainError`, `500`), не гадает.
        throw new Error(
          `data integrity violation: order ${cmd.orderId} is 'processing' but assigned_pharmacist_id is NULL`,
        )
      }

      await this.orderRepository.setAssignedPharmacist(cmd.orderId, cmd.actor.userId, tx)
      const now = this.clock.now()
      const reclaimedEvent: OrderDomainEvent = {
        type: 'OrderReclaimedEvent',
        orderId: cmd.orderId,
        previousPharmacistId,
        newPharmacistId: cmd.actor.userId,
        reason: cmd.reason,
        at: now,
      }
      await this.ordersOutbox.appendAll(cmd.actor.tenantId, [reclaimedEvent], tx)
      this.logger.info(
        { orderId: cmd.orderId, previousPharmacistId, newPharmacistId: cmd.actor.userId, reason: cmd.reason, note: cmd.note },
        'order_reclaimed',
      )

      return { orderId: cmd.orderId, assignedPharmacistId: cmd.actor.userId, slaDeadlineAt: order.toSnapshot().slaDeadlineAt }
    })
  }
}
