/**
 * `ReportItemIssueUseCase` (DTJ-303, EP-12, модуль 24 §A.4, SRS-PHT-017/018) — фармацевт
 * сообщает, что позицию заказа физически невозможно укомплектовать,
 * `POST /api/v1/orders/:id/items/:itemId/report-issue`.
 *
 * Precondition (`orderItem.fulfillmentStatus === 'pending'`) и переход в `unavailable` целиком
 * делегированы `OrderItem.markUnavailable()` (домен, DTJ-302/303) — она же бросает
 * `422 BUSINESS_RULE_VIOLATION` (НЕ `409 ITEM_ALREADY_SCANNED`, в отличие от `assertPending()` —
 * см. её JSDoc) на позиции, которая уже не `pending`. Этот use case, как и `ScanOrderItemUseCase`,
 * сам не принимает решений — только оркестрирует.
 *
 * `InventoryFacade.reconcileZeroStock(medicineId, batchId)` (только для `reason === 'out_of_stock'`,
 * SRS-PHT-018) вызывается ПОСЛЕ того, как `unitOfWork.run(...)` уже вернул результат (транзакция
 * перехода статуса зафиксирована) — НЕ внутри неё, и БЕЗ `await` на её завершение: фигура
 * `void ...catch(...)` гарантирует, что (а) сборка резолвится, не дожидаясь записи в лог сверки,
 * (б) отказ самого лога (например, недоступен Postgres-пул к моменту вызова) не бросает
 * необработанный promise rejection и не ломает уже готовый HTTP-ответ клиенту (DoD тикета:
 * «не блокирует ответ клиенту при недоступности инвентарного лога»).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { ForbiddenError, NotFoundError, type OrderItemDto, type ReportItemIssueReason, type UserRole } from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { OrderItem } from '@/modules/orders/domain/order-item.entity.js'
import { toOrderItemDto } from '@/modules/orders/domain/order.mapper.js'
import { OrderPolicy } from '@/modules/orders/application/policies/order.policy.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
  type OrderUnitOfWorkTx,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { ORDERS_UNIT_OF_WORK, type OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import { INVENTORY_FACADE_PORT, type InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'

export interface ReportItemIssueActor {
  readonly userId: string
  readonly role: UserRole
  readonly tenantId: string
  /** `null` для ролей вне `pharmacist` — `OrderPolicy.canManagePicking` отвергнет их. */
  readonly pharmacyId: string | null
}

export interface ReportItemIssueCommand {
  readonly orderId: string
  readonly itemId: string
  readonly reason: ReportItemIssueReason
  readonly actor: ReportItemIssueActor
}

/** Аргументы отложенного (после коммита) вызова `reconcileZeroStock` — `null`, если reason не `out_of_stock`. */
interface PendingReconcile {
  readonly medicineId: string
  readonly batchId: string
}

@Injectable()
export class ReportItemIssueUseCase {
  // eslint-disable-next-line max-params -- 3 порта (OrderRepository/UnitOfWork/InventoryFacade) + PINO_LOGGER — явные @Inject-параметры, тот же приём, что ScanOrderItemUseCase/CancelOrderUseCase (граф зависимостей остаётся видимым в providers[] модуля, esbuild/vitest не эмитит design:paramtypes, DTJ-001).
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async execute(cmd: ReportItemIssueCommand): Promise<OrderItemDto> {
    const { dto, reconcile } = await this.unitOfWork.run(async (tx) => {
      const { order, item } = await this.loadAuthorizedItem(cmd, tx)
      item.markUnavailable(cmd.reason)
      await this.orderRepository.save(order, tx)
      return { dto: toOrderItemDto(item, order.id), reconcile: toPendingReconcile(cmd.reason, item) }
    })
    this.reconcileZeroStockAfterCommit(reconcile)
    return dto
  }

  /** Загрузка + тенант-скоуп + `OrderPolicy` + позиция — единая точка проверки доступа (см. `ScanOrderItemUseCase`). */
  private async loadAuthorizedItem(
    cmd: ReportItemIssueCommand,
    tx: OrderUnitOfWorkTx,
  ): Promise<{ readonly order: Order; readonly item: OrderItem }> {
    const order = await this.orderRepository.findById(cmd.actor.tenantId, cmd.orderId, tx)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    if (!OrderPolicy.canManagePicking(order, cmd.actor)) {
      throw new ForbiddenError('This order cannot be managed by this actor', { orderId: cmd.orderId })
    }
    const item = order.items.find((candidate) => candidate.id === cmd.itemId)
    if (item === undefined) {
      throw new NotFoundError({ resource: 'orderItem', orderId: cmd.orderId, itemId: cmd.itemId })
    }
    return { order, item }
  }

  /** SRS-PHT-018 — см. JSDoc файла про fire-and-forget-после-коммита. */
  private reconcileZeroStockAfterCommit(reconcile: PendingReconcile | null): void {
    if (reconcile === null) {
      return
    }
    void this.inventoryFacade.reconcileZeroStock(reconcile.medicineId, reconcile.batchId).catch((error: unknown) => {
      this.logger.error({ err: error, ...reconcile }, 'reconcile_zero_stock_failed')
    })
  }
}

/** `out_of_stock` — единственная причина, требующая сигнала расхождения остатка (SRS-PHT-018). */
function toPendingReconcile(reason: ReportItemIssueReason, item: OrderItem): PendingReconcile | null {
  if (reason !== 'out_of_stock') {
    return null
  }
  return { medicineId: item.medicineId, batchId: item.inventoryBatchId }
}
