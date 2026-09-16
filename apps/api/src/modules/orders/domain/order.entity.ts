/**
 * `Order` — корень агрегата (EP-09, DTJ-221/222, `10-domain-model.md` §«Order — слой domain»).
 *
 * DTJ-221: `create()` — инварианты создания (SRS-DOM-002..012), делегированы
 * `order-create.validators.ts` (порядок — DTJ-221 «Что сделать» п.4).
 * DTJ-222: методы-намерения проверяют переход через `order.state-machine.ts`
 * (`ORDER_ALLOWED_TRANSITIONS`, `02` C15) — не собственным `if/else`.
 *
 * Только `status` вынесен отдельным getter'ом (нужен `OrderPolicy`/фасаду напрямую) — остальное
 * состояние читается через `toSnapshot()` (plain object, без приватного доступа снаружи).
 * `toDto()`-маппер в `OrderDto` — отдельный файл `order.mapper.ts` (`C2` ≤300 строк/файл).
 */
import {
  ExpiredStockError,
  InvalidOrderStatusTransitionError,
  type BillingStrategy,
  type DomainError,
  type OrderPaymentMethod,
  type OrderStatus,
} from '@dorutj/contracts'
import { err, ok, type Result } from '@dorutj/domain-kernel'
import type { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'
import { OrderItem } from './order-item.entity.js'
import type { OrderCancelActor, OrderCancelReason, OrderDomainEvent } from './order-domain-event.js'
import type { OrderCreateCommand } from './order-create-command.js'
import {
  validateCodEligibility,
  validateNoControlledSubstances,
  validateNonEmptyItems,
  validatePharmacyActive,
  validatePrescriptionCoverage,
  validateSinglePharmacy,
  validateTotalAmount,
} from './order-create.validators.js'
import { assertRestoreSnapshotIntegrity } from './order-restore.validators.js'
import { isOrderTransitionAllowed } from './order.state-machine.js'
import type { OrderSnapshot } from './order-snapshot.js'

export type { OrderSnapshot }

const ZERO_DIRAM = 0n

/** `startProcessing()` — сгруппировано в команду ради `max-params` (C1, ≤3). */
export interface StartProcessingCommand {
  readonly pharmacistId: string
  readonly slaDeadlineAt: Date
  readonly hasExpiredReservedBatch: boolean
}

export class Order {
  readonly id: string
  readonly orderNumber: OrderNumber
  readonly tenantId: string
  readonly customerId: string
  readonly pharmacyId: string
  readonly items: readonly OrderItem[]
  readonly deliveryFee: Money
  readonly deliveryAddress: string
  readonly deliveryLandmark: string | null
  readonly deliveryGeoPoint: GeoPoint | null
  readonly paymentMethod: OrderPaymentMethod
  readonly billingStrategy: BillingStrategy
  readonly prescriptionId: string | null
  readonly checkoutAttemptId: string
  readonly createdAt: Date

  /**
   * DTJ-304 (EP-12 §A.4, SRS-PHT-020/022, D-10) — `readonly` → приватное поле + геттер
   * (мутирует `recalculateTotals()` ниже). До этого тикета оба поля были `readonly`
   * (DTJ-221: заказ создаётся один раз, сумма после этого не меняется) — терминал
   * фармацевта делает это предположение неверным: частичная сборка ЗАКОННО уменьшает
   * `items_total`/`total_amount` уже СУЩЕСТВУЮЩЕГО заказа. Тот же приём, что `OrderItem`
   * уже применила к своим полям (DTJ-302/303, см. её JSDoc «РАСШИРЕНИЕ») — приватное поле
   * + геттер + метод-намерение, не голый сеттер (`02` §2.2).
   */
  private _itemsTotal: Money
  private _totalAmount: Money
  private _status: OrderStatus
  private _paymentTransactionId: string | null
  private _cancelReason: OrderCancelReason | null
  private _cancelledBy: string | null
  private _slaDeadlineAt: Date | null
  private _processingStartedAt: Date | null
  private _pickedUpAt: Date | null
  private _deliveredAt: Date | null
  private _handoverOtpId: string | null
  private _updatedAt: Date
  private _domainEvents: OrderDomainEvent[] = []

  private constructor(s: OrderSnapshot, items: readonly OrderItem[]) {
    this.id = s.id
    this.orderNumber = s.orderNumber
    this.tenantId = s.tenantId
    this.customerId = s.customerId
    this.pharmacyId = s.pharmacyId
    this.items = items
    this._itemsTotal = s.itemsTotal
    this.deliveryFee = s.deliveryFee
    this._totalAmount = s.totalAmount
    this.deliveryAddress = s.deliveryAddress
    this.deliveryLandmark = s.deliveryLandmark
    this.deliveryGeoPoint = s.deliveryGeoPoint
    this.paymentMethod = s.paymentMethod
    this.billingStrategy = s.billingStrategy
    this.prescriptionId = s.prescriptionId
    this.checkoutAttemptId = s.checkoutAttemptId
    this.createdAt = s.createdAt
    this._status = s.status
    this._paymentTransactionId = s.paymentTransactionId
    this._cancelReason = s.cancelReason
    this._cancelledBy = s.cancelledBy
    this._slaDeadlineAt = s.slaDeadlineAt
    this._processingStartedAt = s.processingStartedAt
    this._pickedUpAt = s.pickedUpAt
    this._deliveredAt = s.deliveredAt
    this._handoverOtpId = s.handoverOtpId
    this._updatedAt = s.updatedAt
  }

  /** Единственный самостоятельный getter — читается `OrderPolicy`/`OrdersFacade` напрямую и часто. */
  get status(): OrderStatus {
    return this._status
  }

  /** DTJ-304 — см. JSDoc поля `_itemsTotal` выше (мутирует `recalculateTotals()`). */
  get itemsTotal(): Money {
    return this._itemsTotal
  }

  /** DTJ-304 — см. JSDoc поля `_totalAmount` выше (мутирует `recalculateTotals()`). */
  get totalAmount(): Money {
    return this._totalAmount
  }

  /** Инварианты ПО ПОРЯДКУ (DTJ-221 п.4) — первая ошибка обрывает, без побочных эффектов. */
  static create(cmd: OrderCreateCommand): Result<Order, DomainError> {
    const structuralError = validateNonEmptyItems(cmd) ?? validateSinglePharmacy(cmd)
    if (structuralError) return err(structuralError)

    const items = cmd.items.map((item) =>
      OrderItem.create({
        id: item.id,
        medicineId: item.medicineId,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        commissionBps: item.commissionBps,
        inventoryBatchId: item.inventoryBatchId,
      }),
    )
    const itemsTotal = items.reduce((sum, item) => sum.add(item.totalPrice), Money.fromDiram(ZERO_DIRAM))

    const businessError =
      validateTotalAmount(cmd, itemsTotal) ??
      validatePrescriptionCoverage(cmd) ??
      validateNoControlledSubstances(cmd) ??
      validateCodEligibility(cmd) ??
      validatePharmacyActive(cmd)
    if (businessError) return err(businessError)

    const order = Order.buildInitial(cmd, items, itemsTotal)
    if (cmd.paymentMethod === 'cash_courier') {
      order.confirm(cmd.now) // SRS-ORD-027 п.1 — синхронно, та же (in-memory) транзакция.
    }
    return ok(order)
  }

  /**
   * Восстановление из снимка (репозиторий, будущий тикет) — без повторной валидации бизнес-правил
   * `create()` (цена/Rx/COD и т.п. — доверие БД). Единственное, что проверяется, — структурная
   * совместимость `paymentMethod`/`status` (D-25): испорченная строка не должна тихо приниматься
   * (тот же принцип, что `save()`-fail-fast вместо no-op — см. `orders.module.ts`).
   */
  static restore(snapshot: OrderSnapshot): Order {
    assertRestoreSnapshotIntegrity(snapshot)
    return new Order(snapshot, snapshot.items.map((item) => OrderItem.restore(item)))
  }

  /** Собирает свежий агрегат в базовом статусе `pending_payment` (= DB default); `cash_courier`
   * переводится в `confirmed` синхронно вызывающим кодом `create()` сразу после. Вынесено из
   * `create()` ради `max-lines-per-function` (C1). */
  private static buildInitial(cmd: OrderCreateCommand, items: readonly OrderItem[], itemsTotal: Money): Order {
    return new Order(
      {
        id: cmd.id,
        orderNumber: cmd.orderNumber,
        tenantId: cmd.tenantId,
        customerId: cmd.customerId,
        pharmacyId: cmd.pharmacyId,
        items: [],
        itemsTotal,
        deliveryFee: cmd.deliveryFee,
        totalAmount: cmd.totalAmount,
        deliveryAddress: cmd.deliveryAddress,
        deliveryLandmark: cmd.deliveryLandmark,
        deliveryGeoPoint: cmd.deliveryGeoPoint,
        paymentMethod: cmd.paymentMethod,
        billingStrategy: cmd.billingStrategy,
        prescriptionId: cmd.prescriptionId,
        checkoutAttemptId: cmd.checkoutAttemptId,
        status: 'pending_payment',
        paymentTransactionId: null,
        cancelReason: null,
        cancelledBy: null,
        slaDeadlineAt: null,
        processingStartedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        handoverOtpId: null,
        createdAt: cmd.now,
        updatedAt: cmd.now,
      },
      items,
    )
  }

  /**
   * D-25 — переводит `cash_courier`-заказ в `confirmed`. НЕ в `ORDER_ALLOWED_TRANSITIONS`
   * (структурно недостижим из любого другого статуса/метода) — bespoke-guard вместо таблицы:
   * разрешено только из начального `pending_payment` свежего агрегата, только для `cash_courier`.
   */
  confirm(now: Date): void {
    if (this._status !== 'pending_payment' || this.paymentMethod !== 'cash_courier') {
      this.throwInvalidTransition('confirmed', 'confirm() valid only from the fresh pending_payment state for cash_courier orders')
    }
    this._status = 'confirmed'
    this._updatedAt = now
    // Внутренний факт для DTJ-256 (SRS-DOM-180), НЕ OrderPaidEvent — D-25.
    this._domainEvents.push({ type: 'OrderConfirmedEvent', orderId: this.id, at: now })
  }

  /** `pending_payment → paid_escrow` (SRS-DOM-089). `ledgerHoldWillBeRecorded: true` — обязательный
   * параметр (не опция) — компиляционное напоминание: вызывающий код (DTJ-243) обязан вызвать
   * `EscrowLedger.recordHold()` в ТОЙ ЖЕ транзакции (SRS-DOM-180/SRS-ORD-027a).
   *
   * `paymentMethod` проверяется ЯВНО, ДО таблицы переходов (симметрично `confirm()`, D-25,
   * `21-module-orders-payments-escrow.md:1129/689` — `paid_escrow` для `cash_courier`
   * недостижим СТРУКТУРНО, не только по соглашению application-слоя). */
  markPaidEscrow(txId: string, paidAt: Date, ledgerHoldWillBeRecorded: true): void {
    void ledgerHoldWillBeRecorded
    if (this.paymentMethod === 'cash_courier') {
      this.throwInvalidTransition('paid_escrow', 'cash_courier orders never reach paid_escrow — D-25, structural, independent of current status')
    }
    this.assertTransition('paid_escrow')
    this._status = 'paid_escrow'
    this._paymentTransactionId = txId
    this._updatedAt = paidAt
    // OrderPaidEvent публикует `payments` (webhook use case), не `orders` — глоссарий событий.
  }

  /** `paid_escrow|confirmed → processing` (SRS-DOM-091/178). `hasExpiredReservedBatch` уже
   * резолвлен вызывающим кодом через `InventoryFacadePort` (SRS-DOM-006); `slaDeadlineAt`
   * (= `now + pickup_sla_minutes`) уже вычислен вызывающим кодом — домен не строит `Date`
   * арифметикой (`§2.6`, `no-restricted-globals` на `Date`), только принимает готовое значение. */
  startProcessing(cmd: StartProcessingCommand, now: Date): void {
    this.assertTransition('processing')
    if (cmd.hasExpiredReservedBatch) {
      throw new ExpiredStockError({ orderId: this.id })
    }
    this._status = 'processing'
    this._processingStartedAt = now
    this._slaDeadlineAt = cmd.slaDeadlineAt
    this._updatedAt = now
    this._domainEvents.push({
      type: 'OrderProcessingStartedEvent',
      orderId: this.id,
      pharmacistId: cmd.pharmacistId,
      slaDeadlineAt: cmd.slaDeadlineAt,
    })
  }

  /** `processing → picked_up` (SRS-DOM-094). */
  markPickedUp(handoverOtpId: string, now: Date): void {
    this.assertTransition('picked_up')
    this._status = 'picked_up'
    this._pickedUpAt = now
    this._handoverOtpId = handoverOtpId
    this._updatedAt = now
    this._domainEvents.push({ type: 'OrderPickedUpEvent', orderId: this.id, handoverOtpId, at: now })
  }

  /** `picked_up → delivered` (SRS-DOM-095). `OrderDeliveredEvent` публикует `delivery`. */
  markDelivered(now: Date): void {
    this.assertTransition('delivered')
    this._status = 'delivered'
    this._deliveredAt = now
    this._updatedAt = now
  }

  /** Отмена (SRS-DOM-090/092/093/154/179) — только переход + метаданные; денежное решение
   * (рефанд/нет, D-25) принимает вызывающий use case, не этот метод. */
  cancel(reason: OrderCancelReason, actor: OrderCancelActor, now: Date): void {
    this.assertTransition('cancelled')
    this._status = 'cancelled'
    this._cancelReason = reason
    this._cancelledBy = actor.kind === 'user' ? actor.userId : null
    this._updatedAt = now
    this._domainEvents.push({
      type: 'OrderCancelledEvent',
      orderId: this.id,
      reason,
      cancelledBy: this._cancelledBy,
      at: now,
    })
  }

  /**
   * DTJ-304 (EP-12 §A.4, SRS-PHT-020/022, D-10) — пересчитывает `itemsTotal`/`totalAmount`
   * БЕЗ позиций `fulfillmentStatus === 'unavailable'` (частичная сборка). Чистая функция
   * текущего состояния позиций — детерминированная и идемпотентная (повторный вызов на тех
   * же позициях даёт тот же результат), поэтому безопасно вызывается ДВАЖДЫ за жизненный
   * цикл одного запроса частичной сборки: (1) `ProposePartialFulfillmentUseCase` — ТОЛЬКО
   * для предпросмотра `itemsTotalAfterDiram`, сохраняемого в `order_partial_fulfillment_
   * requests`, БЕЗ последующего `OrderRepositoryPort.save(order)` — заказ в БД не меняется;
   * (2) `ResolvePartialFulfillmentUseCase` (`confirmed=true`) — фиксирует результат, ЗА ней
   * следует `save(order)`. Не проверяет статус заказа/переход (`assertTransition`) — это не
   * переход состояния машины `orders.status`, только пересчёт денежной суммы, вызывающий use
   * case решает, когда её вызывать.
   *
   * НЕ проверяет и не требует ни одной `unavailable`-позиции — на пустом множестве
   * unavailable результат тривиально равен исходной сумме (используется как чистый
   * предпросмотр без побочных эффектов на любых позициях).
   */
  recalculateTotals(now: Date): void {
    const itemsTotal = this.items
      .filter((item) => item.fulfillmentStatus !== 'unavailable')
      .reduce((sum, item) => sum.add(item.totalPrice), Money.fromDiram(ZERO_DIRAM))
    this._itemsTotal = itemsTotal
    this._totalAmount = itemsTotal.add(this.deliveryFee)
    this._updatedAt = now
  }

  /** Заготовка EP-11 (`tickets/00-EPICS.md:30` — эпик документирован, тикеты не нарезаны;
   * маркер владельца без `DTJ-*` утверждён CTO, D-EP09-8). `picked_up|delivered → return_in_progress`. */
  attachReturn(_returnId: string, now: Date): void {
    this.assertTransition('return_in_progress')
    this._status = 'return_in_progress'
    this._updatedAt = now
  }

  /** Заготовка EP-11 (см. `attachReturn`). `return_in_progress → refunded`. */
  markRefunded(_refundRef: string, now: Date): void {
    this.assertTransition('refunded')
    this._status = 'refunded'
    this._updatedAt = now
  }

  /** Снимок накопленных событий, сбрасывает буфер (SRS-DOM-151; outbox — забота use case). */
  pullDomainEvents(): readonly OrderDomainEvent[] {
    const events = this._domainEvents
    this._domainEvents = []
    return events
  }

  /** Полный plain-снимок для персистентности/мапперов (`order.mapper.ts`) — единственное место
   * прямого чтения приватных полей извне класса. */
  toSnapshot(): OrderSnapshot {
    return {
      id: this.id,
      orderNumber: this.orderNumber,
      tenantId: this.tenantId,
      customerId: this.customerId,
      pharmacyId: this.pharmacyId,
      items: this.items.map((item) => item.toSnapshot()),
      itemsTotal: this.itemsTotal,
      deliveryFee: this.deliveryFee,
      totalAmount: this.totalAmount,
      deliveryAddress: this.deliveryAddress,
      deliveryLandmark: this.deliveryLandmark,
      deliveryGeoPoint: this.deliveryGeoPoint,
      paymentMethod: this.paymentMethod,
      billingStrategy: this.billingStrategy,
      prescriptionId: this.prescriptionId,
      checkoutAttemptId: this.checkoutAttemptId,
      status: this._status,
      paymentTransactionId: this._paymentTransactionId,
      cancelReason: this._cancelReason,
      cancelledBy: this._cancelledBy,
      slaDeadlineAt: this._slaDeadlineAt,
      processingStartedAt: this._processingStartedAt,
      pickedUpAt: this._pickedUpAt,
      deliveredAt: this._deliveredAt,
      handoverOtpId: this._handoverOtpId,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    }
  }

  /** Единственная точка проверки перехода (`order.state-machine.ts`, DoD DTJ-222). */
  private assertTransition(to: OrderStatus): void {
    if (!isOrderTransitionAllowed(this._status, to)) {
      this.throwInvalidTransition(to)
    }
  }

  /** Общая точка построения ошибки для `assertTransition`/bespoke-guards `confirm()`/`markPaidEscrow()`. */
  private throwInvalidTransition(to: OrderStatus, reason?: string): never {
    throw new InvalidOrderStatusTransitionError({ orderId: this.id, from: this._status, to, reason })
  }
}
