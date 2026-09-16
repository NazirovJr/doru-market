/**
 * `ResolvePartialFulfillmentUseCase` (DTJ-304, EP-12, модуль 24 §A.4, SRS-PHT-021/022/023/023a)
 * — разрешение запроса частичной сборки, вызывается ДВУМЯ путями (см. «Технический контекст»
 * тикета): (1) клиентский `confirm`/`reject` — presentation-обёртка ВНЕ этого эпика (владелец
 * `apps/web`), этот use case — источник правды денежного/доменного эффекта; (2)
 * `PartialFulfillmentTimeoutProcessor` (`infrastructure/jobs/`, ЭТОТ тикет, `confirmed=true,
 * source='timeout'`).
 *
 * **Идемпотентность/гонка (TC-PHT-013, SRS-PHT-023a)** — ЕДИНСТВЕННЫЙ источник истины: CAS
 * `PartialFulfillmentRequestRepositoryPort.transitionStatus` (`UPDATE ... WHERE status =
 * 'awaiting_customer'`). Явный ответ клиента и срабатывание таймера могут прийти
 * ПОЧТИ одновременно — кто бы ни выиграл `transitionStatus`, ПРОИГРАВШИЙ получает `false` и
 * завершается идемпотентным no-op (текущий/финальный статус строки, БЕЗ повторного применения
 * денежного/доменного эффекта). Ни PostgreSQL advisory lock, ни `SELECT ... FOR UPDATE` не
 * нужны — тот же класс гарантии, что `ux_escrow_ledger_refunded_once`/`RefundOrderUseCase`.
 *
 * **Три ветки (SRS-PHT-022/023/023a):**
 * - `confirmed=true` (явно ИЛИ `source='timeout'`) — `Order.recalculateTotals()` фиксирует
 *   `items_total`/`total_amount` (СОХРАНЯЕТСЯ, в отличие от `ProposePartialFulfillmentUseCase`'s
 *   предпросмотра), публикует `PartialFulfillmentConfirmedEvent`/`AutoConfirmedEvent`. ПОСЛЕ
 *   коммита транзакции (payment provider — НИКОГДА внутри транзакции БД, тот же урок, что
 *   `RefundOrderUseCase`/`RefundFacadeAdapter`, см. их JSDoc про исчерпание пула соединений) —
 *   `RefundFacadePort.refundPartialFulfillment`. Given провайдер недоступен (`Что сделать` п.5
 *   тикета, SRS-PHT-075): статус запроса УЖЕ `confirmed`/`auto_confirmed_timeout` и НЕ
 *   откатывается (клиент согласился — этот факт не зависит от банка), публикуется
 *   `PartialFulfillmentRefundRetryRequestedEvent` (см. её JSDoc — задел на будущую
 *   retry-задачу) ОТДЕЛЬНОЙ короткой транзакцией, use case бросает `503
 *   PaymentProviderUnavailableError` вызывающему коду (HTTP-контроллер клиента ВНЕ этого
 *   тикета/BullMQ-джоба — обе стороны трактуют бросок как «повторить позже», не как откат).
 * - `confirmed=false` — SRS-PHT-023: `order.cancel('customer_rejected_partial_fulfillment',
 *   customer)` (существующий доменный метод, ТОТ ЖЕ приём, что `CancelOrderUseCase`: release
 *   резерва ВСЕХ ещё зарезервированных позиций + `RefundFacadePort.refundFull`, ОБА — ПОСЛЕ
 *   коммита транзакции отмены, СНАРУЖИ неё). `source` при `confirmed=false` СТРУКТУРНО всегда
 *   `'customer'` (SRS-PHT-023a: молчание клиента трактуется как СОГЛАСИЕ, `source='timeout'`
 *   никогда не производит `confirmed=false` — вызывающий код гарантирует эту пару, use case не
 *   перепроверяет `source` в этой ветке).
 */
import { Inject, Injectable } from '@nestjs/common'
import { isErr } from '@dorutj/domain-kernel'
import { NotFoundError, PaymentProviderUnavailableError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { OrderDomainEvent } from '@/modules/orders/domain/order-domain-event.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
} from '@/modules/orders/application/ports/order-repository.port.js'
import type { OrderUnitOfWorkTx } from '@/modules/orders/application/ports/order-repository.port.js'
import { ORDERS_UNIT_OF_WORK, type OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import { ORDERS_OUTBOX, type OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import {
  INVENTORY_FACADE_PORT,
  type InventoryFacadePort,
  type ReleaseStockItemCommand,
} from '@/modules/orders/application/ports/inventory-facade.port.js'
import { REFUND_FACADE_PORT, type RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import {
  PARTIAL_FULFILLMENT_REQUEST_REPOSITORY,
  type PartialFulfillmentRequestRecord,
  type PartialFulfillmentRequestRepositoryPort,
  type PartialFulfillmentStatus,
} from '@/modules/orders/application/ports/partial-fulfillment-request-repository.port.js'

export interface ResolvePartialFulfillmentCommand {
  readonly requestId: string
  readonly tenantId: string
  readonly confirmed: boolean
  readonly source: 'customer' | 'timeout'
}

export interface ResolvePartialFulfillmentResult {
  readonly requestId: string
  readonly orderId: string
  readonly status: PartialFulfillmentStatus
}

/** Извлечено из `resolveWithinTransaction` — три ветки с разным «хвостом» после коммита (C1 `max-lines-per-function`). */
type ResolveOutcome =
  | { readonly kind: 'noop'; readonly requestId: string; readonly orderId: string; readonly status: PartialFulfillmentStatus }
  | {
      readonly kind: 'confirmed'
      readonly requestId: string
      readonly orderId: string
      readonly status: 'confirmed' | 'auto_confirmed_timeout'
      readonly refundAmountDiram: bigint
    }
  | {
      readonly kind: 'rejected'
      readonly requestId: string
      readonly orderId: string
      readonly status: 'rejected'
      readonly paymentMethod: Order['paymentMethod']
      readonly releaseItems: readonly ReleaseStockItemCommand[]
    }

/** Извлечено из сигнатур `applyConfirmed`/`applyRejected` — C1 (`max-params`, порог 3), тот же приём, что `ApplyOutcomeInput` в `RefundOnReturnResolvedUseCase` (`modules/returns`). */
interface ApplyOutcomeInput {
  readonly request: PartialFulfillmentRequestRecord
  readonly order: Order
  readonly now: Date
  readonly tenantId: string
  readonly tx: OrderUnitOfWorkTx
}

const CASH_PAYMENT_METHOD = 'cash_courier'

@Injectable()
export class ResolvePartialFulfillmentUseCase {
  // eslint-disable-next-line max-params -- 6 портов (OrderRepository/UnitOfWork/Outbox/InventoryFacade/RefundFacade/PartialFulfillmentRequestRepository) + Clock — явные @Inject, тот же приём, что CancelOrderUseCase/RefundOrderUseCase.
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(ORDERS_OUTBOX) private readonly ordersOutbox: OrdersOutboxPort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(REFUND_FACADE_PORT) private readonly refundFacade: RefundFacadePort,
    @Inject(PARTIAL_FULFILLMENT_REQUEST_REPOSITORY) private readonly requestRepository: PartialFulfillmentRequestRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(cmd: ResolvePartialFulfillmentCommand): Promise<ResolvePartialFulfillmentResult> {
    const outcome = await this.unitOfWork.run((tx) => this.resolveWithinTransaction(cmd, tx))
    if (outcome.kind === 'confirmed') {
      await this.issueConfirmedRefund(cmd.tenantId, outcome)
    } else if (outcome.kind === 'rejected') {
      await this.finishRejection(outcome)
    }
    return { requestId: outcome.requestId, orderId: outcome.orderId, status: outcome.status }
  }

  private async resolveWithinTransaction(cmd: ResolvePartialFulfillmentCommand, tx: OrderUnitOfWorkTx): Promise<ResolveOutcome> {
    const request = await this.requestRepository.findById(cmd.tenantId, cmd.requestId, tx)
    if (request === null) {
      throw new NotFoundError({ resource: 'partialFulfillmentRequest', requestId: cmd.requestId })
    }
    if (request.status !== 'awaiting_customer') {
      return { kind: 'noop', requestId: request.id, orderId: request.orderId, status: request.status }
    }

    const now = this.clock.now()
    const toStatus: PartialFulfillmentStatus = cmd.confirmed ? (cmd.source === 'timeout' ? 'auto_confirmed_timeout' : 'confirmed') : 'rejected'
    const transitioned = await this.requestRepository.transitionStatus(
      { id: request.id, fromStatus: 'awaiting_customer', toStatus, respondedAt: now },
      tx,
    )
    if (!transitioned) {
      return this.reloadAsNoop(cmd, tx)
    }

    const order = await this.orderRepository.findById(cmd.tenantId, request.orderId, tx)
    if (order === null) {
      throw new Error(`ResolvePartialFulfillmentUseCase: order ${request.orderId} not found for request ${request.id} — invariant violation.`)
    }
    const applyInput: ApplyOutcomeInput = { request, order, now, tenantId: cmd.tenantId, tx }
    if (cmd.confirmed) {
      return this.applyConfirmed(applyInput, toStatus as 'confirmed' | 'auto_confirmed_timeout')
    }
    return this.applyRejected(applyInput)
  }

  /** Гонка проиграна (TC-PHT-013) — перечитывает АКТУАЛЬНЫЙ статус строки (уже изменённый победителем). */
  private async reloadAsNoop(cmd: ResolvePartialFulfillmentCommand, tx: OrderUnitOfWorkTx): Promise<ResolveOutcome> {
    const settled = await this.requestRepository.findById(cmd.tenantId, cmd.requestId, tx)
    if (settled === null) {
      throw new Error(`ResolvePartialFulfillmentUseCase: request ${cmd.requestId} disappeared mid-transaction — invariant violation.`)
    }
    return { kind: 'noop', requestId: settled.id, orderId: settled.orderId, status: settled.status }
  }

  /** SRS-PHT-022 п.2-4 — фиксация нового итога + событие. `save()`/`recalculateTotals()` — см. JSDoc файла. */
  private async applyConfirmed(input: ApplyOutcomeInput, status: 'confirmed' | 'auto_confirmed_timeout'): Promise<ResolveOutcome> {
    const { request, order, now, tenantId, tx } = input
    order.recalculateTotals(now)
    await this.orderRepository.save(order, tx)
    const event: OrderDomainEvent =
      status === 'auto_confirmed_timeout'
        ? { type: 'PartialFulfillmentAutoConfirmedEvent', orderId: order.id, requestId: request.id, at: now }
        : { type: 'PartialFulfillmentConfirmedEvent', orderId: order.id, requestId: request.id, at: now }
    await this.ordersOutbox.appendAll(tenantId, [...order.pullDomainEvents(), event], tx)
    return { kind: 'confirmed', requestId: request.id, orderId: order.id, status, refundAmountDiram: request.refundAmountDiram }
  }

  /** SRS-PHT-023 — весь заказ отменяется (SRS-DOM-093), `[РАСШИРЕНИЕ]` актёр = сам клиент. */
  private async applyRejected(input: ApplyOutcomeInput): Promise<ResolveOutcome> {
    const { request, order, now, tenantId, tx } = input
    const releaseItems = toReleaseItems(order)
    const paymentMethod = order.paymentMethod
    order.cancel('customer_rejected_partial_fulfillment', { kind: 'user', userId: order.customerId }, now)
    await this.orderRepository.save(order, tx)
    const event: OrderDomainEvent = { type: 'PartialFulfillmentRejectedEvent', orderId: order.id, requestId: request.id, at: now }
    await this.ordersOutbox.appendAll(tenantId, [...order.pullDomainEvents(), event], tx)
    return { kind: 'rejected', requestId: request.id, orderId: order.id, status: 'rejected', paymentMethod, releaseItems }
  }

  /** ПОСЛЕ коммита — см. JSDoc файла «НИКОГДА внутри транзакции БД». */
  private async issueConfirmedRefund(tenantId: string, outcome: Extract<ResolveOutcome, { kind: 'confirmed' }>): Promise<void> {
    const result = await this.refundFacade.refundPartialFulfillment({
      orderId: outcome.orderId,
      refundAmountDiram: outcome.refundAmountDiram,
    })
    if (isErr(result)) {
      await this.scheduleRefundRetry(tenantId, outcome)
      throw new PaymentProviderUnavailableError({ orderId: outcome.orderId, requestId: outcome.requestId, cause: result.error })
    }
  }

  /** SRS-PHT-075/«Что сделать» п.5 — публикует сигнал retry ОТДЕЛЬНОЙ короткой транзакцией (см. JSDoc файла). */
  private async scheduleRefundRetry(tenantId: string, outcome: Extract<ResolveOutcome, { kind: 'confirmed' }>): Promise<void> {
    const event: OrderDomainEvent = {
      type: 'PartialFulfillmentRefundRetryRequestedEvent',
      orderId: outcome.orderId,
      requestId: outcome.requestId,
      refundAmountDiram: outcome.refundAmountDiram,
      at: this.clock.now(),
    }
    await this.unitOfWork.run((tx) => this.ordersOutbox.appendAll(tenantId, [event], tx))
  }

  /** ПОСЛЕ коммита — 1:1 приём `CancelOrderUseCase.execute` (release ВСЕГДА, потом рефанд). */
  private async finishRejection(outcome: Extract<ResolveOutcome, { kind: 'rejected' }>): Promise<void> {
    await this.inventoryFacade.releaseStock(outcome.releaseItems)
    if (outcome.paymentMethod === CASH_PAYMENT_METHOD) {
      return
    }
    const result = await this.refundFacade.refundFull(outcome.orderId, 'customer_rejected_partial_fulfillment')
    if (isErr(result)) {
      throw new PaymentProviderUnavailableError({ orderId: outcome.orderId, cause: result.error })
    }
  }
}

/** 1:1 `CancelOrderUseCase.toReleaseItems` — освобождает резерв ВСЕХ позиций (SRS-PHT-023: «резерв ВСЕХ ещё зарезервированных»). */
function toReleaseItems(order: Order): readonly ReleaseStockItemCommand[] {
  return order.items.map((item) => ({ inventoryBatchId: item.inventoryBatchId, quantity: item.quantity }))
}
