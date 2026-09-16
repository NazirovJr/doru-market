/**
 * `ProposePartialFulfillmentUseCase` (DTJ-304, EP-12, модуль 24 §A.4, SRS-PHT-019/020) —
 * `POST /api/v1/orders/:id/propose-partial-fulfillment`. Фармацевт запрашивает подтверждение
 * клиентом изменённого (уменьшённого) состава заказа, когда ≥1 позиция помечена `unavailable`
 * (DTJ-303, `report-issue`) и решение принято по КАЖДОЙ позиции заказа.
 *
 * Precondition — ДВЕ отдельные проверки (буквальный текст SRS-PHT-019/020, `[РАСШИРЕНИЕ]`
 * второй): (1) НИ ОДНОЙ позиции `pending` → иначе `422 BUSINESS_RULE_VIOLATION`
 * (`details.unresolvedItemIds`, TC-PHT-010); (2) ХОТЯ БЫ ОДНА позиция `unavailable` — без неё
 * предлагать «изменённый» состав нечего (эндпоинт существует ИСКЛЮЧИТЕЛЬНО для этого сценария,
 * см. «Задача» тикета) — тот же код ошибки, другая деталь (`reason`), не отдельный класс.
 *
 * `itemsTotalAfterDiram` — `Order.recalculateTotals()` (DTJ-304, `orders/domain/order.entity.ts`)
 * вызывается для ПРЕДПРОСМОТРА: результат читается через `order.itemsTotal`/`totalAmount`
 * СРАЗУ после вызова, `OrderRepositoryPort.save(order)` НЕ вызывается — заказ в БД не меняется
 * (это происходит только при подтверждении, `ResolvePartialFulfillmentUseCase`, SRS-PHT-022 п.2).
 *
 * Атомарность (`Что сделать` п.2 тикета: «планирование BullMQ delayed job... в ТОЙ ЖЕ
 * транзакции, что и создание запроса») — `OrdersUnitOfWorkPort.run(...)` оборачивает и
 * `PartialFulfillmentRequestRepositoryPort.create`, и `PartialFulfillmentTimeoutQueuePort.
 * schedule` (Redis, НЕ участвует в самой Postgres-транзакции — «в той же транзакции» здесь
 * означает «в той же логической единице работы, до успешного `COMMIT` строки запроса
 * планирование не считается завершённым», не истинный 2PC Postgres+Redis, недостижимый без
 * распределённого координатора). Если `schedule()` бросит ПОСЛЕ `create()`, транзакция БД
 * откатится целиком (строка запроса не останется без таймера) — `unitOfWork.run` откатывает
 * ВЕСЬ callback при любом исключении внутри (та же гарантия, что `AcceptOrderUseCase`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError, BusinessRuleViolationError, type UserRole } from '@dorutj/contracts'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { OrderDomainEvent, PartialFulfillmentSnapshotItem } from '@/modules/orders/domain/order-domain-event.js'
import { OrderPolicy } from '@/modules/orders/application/policies/order.policy.js'
import { CATALOG_FACADE_PORT, type CatalogFacadePort } from '@/modules/orders/application/ports/catalog-facade.port.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
  type OrderUnitOfWorkTx,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { ORDERS_UNIT_OF_WORK, type OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import { ORDERS_OUTBOX, type OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import { TENANCY_FACADE_PORT, type TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import {
  PARTIAL_FULFILLMENT_REQUEST_REPOSITORY,
  type PartialFulfillmentRequestRecord,
  type PartialFulfillmentRequestRepositoryPort,
} from '@/modules/orders/application/ports/partial-fulfillment-request-repository.port.js'
import {
  PARTIAL_FULFILLMENT_TIMEOUT_QUEUE,
  type PartialFulfillmentTimeoutQueuePort,
} from '@/modules/orders/application/ports/partial-fulfillment-timeout-queue.port.js'

const MS_PER_MINUTE = 60_000

export interface ProposePartialFulfillmentActor {
  readonly userId: string
  readonly role: UserRole
  readonly tenantId: string
  readonly pharmacyId: string | null
}

export interface ProposePartialFulfillmentCommand {
  readonly orderId: string
  /** = заголовок `Idempotency-Key` (СЫРОЙ UUID v4) — персистируется на строку запроса, тот же
   *  приём, что `checkoutAttemptId`/`Idempotency-Key` в `CheckoutCommand` (`checkout.controller.ts`). */
  readonly idempotencyKey: string
  readonly actor: ProposePartialFulfillmentActor
}

/** Извлечено из `execute`/`buildPreview`/`persist` — C1 (`max-lines-per-function`/`max-params`). */
interface ProposalPreview {
  readonly now: Date
  readonly itemsTotalBeforeDiram: bigint
  readonly itemsTotalAfterDiram: bigint
  readonly refundAmountDiram: bigint
  readonly timeoutMinutes: number
  readonly expiresAt: Date
  readonly itemsSnapshot: readonly PartialFulfillmentSnapshotItem[]
}

/** Извлечено из `persist` — C1 (`max-params`, порог 3). */
interface PersistInput {
  readonly cmd: ProposePartialFulfillmentCommand
  readonly order: Order
  readonly preview: ProposalPreview
  readonly tx: OrderUnitOfWorkTx
}

/** Возвращаемый use case'ом плоский результат — `PartialFulfillmentController` мапит в DTO контракта. */
export interface ProposePartialFulfillmentResult {
  readonly id: string
  readonly orderId: string
  readonly status: 'awaiting_customer'
  readonly itemsSnapshot: readonly PartialFulfillmentSnapshotItem[]
  readonly itemsTotalBeforeDiram: bigint
  readonly itemsTotalAfterDiram: bigint
  readonly refundAmountDiram: bigint
  readonly expiresAt: Date
}

@Injectable()
export class ProposePartialFulfillmentUseCase {
  // eslint-disable-next-line max-params -- 7 портов (OrderRepository/UnitOfWork/Outbox/Tenancy/CatalogFacade/PartialFulfillmentRequestRepository/TimeoutQueue) + Clock/IdGenerator — явные @Inject, тот же приём, что RefundOrderUseCase/AcceptOrderUseCase (граф зависимостей остаётся видимым в providers[]).
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(ORDERS_OUTBOX) private readonly ordersOutbox: OrdersOutboxPort,
    @Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort,
    @Inject(CATALOG_FACADE_PORT) private readonly catalogFacade: CatalogFacadePort,
    @Inject(PARTIAL_FULFILLMENT_REQUEST_REPOSITORY) private readonly requestRepository: PartialFulfillmentRequestRepositoryPort,
    @Inject(PARTIAL_FULFILLMENT_TIMEOUT_QUEUE) private readonly timeoutQueue: PartialFulfillmentTimeoutQueuePort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
  ) {}

  async execute(cmd: ProposePartialFulfillmentCommand): Promise<ProposePartialFulfillmentResult> {
    const order = await this.loadAuthorizedOrder(cmd)
    assertAllItemsResolved(order)
    const unavailableItems = order.items.filter((item) => item.fulfillmentStatus === 'unavailable')
    assertHasUnavailableItem(unavailableItems)

    const preview = await this.buildPreview(cmd, order, unavailableItems)
    const request = await this.unitOfWork.run((tx) => this.persist({ cmd, order, preview, tx }))
    return toResult(request)
  }

  /** Извлечено из `execute` — C1 (`max-lines-per-function`, порог 40). ПРЕДПРОСМОТР — см. JSDoc файла: `save()` НЕ вызывается. */
  private async buildPreview(
    cmd: ProposePartialFulfillmentCommand,
    order: Order,
    unavailableItems: readonly Order['items'][number][],
  ): Promise<ProposalPreview> {
    const now = this.clock.now()
    const itemsTotalBeforeDiram = order.itemsTotal.diram
    order.recalculateTotals(now)
    const itemsTotalAfterDiram = order.itemsTotal.diram
    const refundAmountDiram = itemsTotalBeforeDiram - itemsTotalAfterDiram
    const timeoutMinutes = await this.tenancyFacade.getPartialFulfillmentConfirmationTimeoutMinutes(cmd.actor.tenantId)
    const expiresAt = addMinutes(now, timeoutMinutes)
    const itemsSnapshot = await this.buildItemsSnapshot(unavailableItems)
    return { now, itemsTotalBeforeDiram, itemsTotalAfterDiram, refundAmountDiram, timeoutMinutes, expiresAt, itemsSnapshot }
  }

  /** Извлечено из `execute` — создание строки + планирование джобы + outbox, ОДНА транзакция (см. JSDoc файла). */
  private async persist(input: PersistInput): Promise<PartialFulfillmentRequestRecord> {
    const { cmd, order, preview, tx } = input
    const created = await this.requestRepository.create(
      {
        id: this.idGenerator.next(),
        orderId: order.id,
        proposedBy: cmd.actor.userId,
        itemsSnapshot: preview.itemsSnapshot,
        itemsTotalBeforeDiram: preview.itemsTotalBeforeDiram,
        itemsTotalAfterDiram: preview.itemsTotalAfterDiram,
        refundAmountDiram: preview.refundAmountDiram,
        idempotencyKey: cmd.idempotencyKey,
        expiresAt: preview.expiresAt,
      },
      tx,
    )
    await this.timeoutQueue.schedule({ requestId: created.id, tenantId: cmd.actor.tenantId, timeoutMinutes: preview.timeoutMinutes })
    const event: OrderDomainEvent = {
      type: 'PartialFulfillmentProposedEvent',
      orderId: order.id,
      requestId: created.id,
      itemsSnapshot: preview.itemsSnapshot,
      refundAmountDiram: preview.refundAmountDiram,
      expiresAt: preview.expiresAt,
      at: preview.now,
    }
    await this.ordersOutbox.appendAll(cmd.actor.tenantId, [event], tx)
    return created
  }

  /** Загрузка + тенант-скоуп + `OrderPolicy` — единая точка проверки доступа (см. `ScanOrderItemUseCase`/`ReportItemIssueUseCase`). */
  private async loadAuthorizedOrder(cmd: ProposePartialFulfillmentCommand): Promise<Order> {
    const order = await this.orderRepository.findById(cmd.actor.tenantId, cmd.orderId)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    if (!OrderPolicy.canManagePicking(order, cmd.actor)) {
      throw new ForbiddenError('This order cannot be managed by this actor', { orderId: cmd.orderId })
    }
    return order
  }

  /**
   * `medicineName` — снэпшот `medicines.trade_name` НА МОМЕНТ запроса (SRS-PHT-020, JSDoc
   * `PartialFulfillmentSnapshotItem`) — `OrderItem` не несёт названия (только `medicineId`,
   * `02` §2.6: цена/название — забота `catalog`, не `orders`), резолвится ОДНИМ батч-вызовом
   * `CatalogFacadePort.getMedicineSnapshot` (не N+1, тот же приём, что `checkout`/`cart`).
   * Отсутствующая в каталоге запись (удалён препарат) — `medicineId` как безопасный fallback
   * (снимок ВСЁ РАВНО обязан существовать для UI клиента, тихий сбой всего `propose` из-за
   * стороннего расхождения каталога был бы хуже неидеального отображаемого имени).
   */
  private async buildItemsSnapshot(unavailableItems: readonly Order['items'][number][]): Promise<readonly PartialFulfillmentSnapshotItem[]> {
    const medicineIds = unavailableItems.map((item) => item.medicineId)
    const snapshots = await this.catalogFacade.getMedicineSnapshot(medicineIds)
    return unavailableItems.map((item) => {
      if (item.itemIssueReason === null) {
        // Инвариант домена: `markUnavailable(reason)` ВСЕГДА устанавливает `itemIssueReason` (DTJ-303).
        throw new Error(`ProposePartialFulfillmentUseCase: unavailable order item ${item.id} has no itemIssueReason — invariant violation.`)
      }
      return {
        orderItemId: item.id,
        medicineName: snapshots.get(item.medicineId)?.tradeName ?? item.medicineId,
        quantity: item.quantity,
        reason: item.itemIssueReason,
      }
    })
  }
}

/** SRS-PHT-020 — ни одной `pending`-позиции (TC-PHT-010). */
function assertAllItemsResolved(order: Order): void {
  const unresolvedItemIds = order.items.filter((item) => item.fulfillmentStatus === 'pending').map((item) => item.id)
  if (unresolvedItemIds.length > 0) {
    throw new BusinessRuleViolationError(
      'Cannot propose partial fulfillment while some order items are still pending a scan/report-issue decision',
      { unresolvedItemIds },
    )
  }
}

/** См. JSDoc файла — precondition (2), `[РАСШИРЕНИЕ]`: эндпоинт существует только для этого сценария. */
function assertHasUnavailableItem(unavailableItems: readonly { id: string }[]): void {
  if (unavailableItems.length === 0) {
    throw new BusinessRuleViolationError(
      'Cannot propose partial fulfillment when no order item is unavailable — nothing to propose',
      { reason: 'no_unavailable_items' },
    )
  }
}

/** Application-слой, не domain (`02` §2.6) — 1:1 приём `AcceptOrderUseCase.addMinutes`. */
function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE)
}

function toResult(request: PartialFulfillmentRequestRecord): ProposePartialFulfillmentResult {
  if (request.status !== 'awaiting_customer') {
    // Недостижимо: `create()` только что вставила строку с DB-дефолтом статуса.
    throw new Error(`ProposePartialFulfillmentUseCase: newly created request ${request.id} has unexpected status "${request.status}".`)
  }
  return {
    id: request.id,
    orderId: request.orderId,
    status: request.status,
    itemsSnapshot: request.itemsSnapshot,
    itemsTotalBeforeDiram: request.itemsTotalBeforeDiram,
    itemsTotalAfterDiram: request.itemsTotalAfterDiram,
    refundAmountDiram: request.refundAmountDiram,
    expiresAt: request.expiresAt,
  }
}
