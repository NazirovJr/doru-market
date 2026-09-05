/**
 * Порт `PaymentsOrdersPort` (EP-10, DTJ-236, `21-module-orders-payments-escrow.md` §5.1/§9).
 *
 * Межмодульный фасад `payments → orders` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2) —
 * ЕДИНСТВЕННЫЙ разрешённый способ, которым `payments` читает/меняет заказ. Прямой импорт
 * `modules/orders/domain/*`/`modules/orders/application/*` из `payments` — блокирующее
 * нарушение (`dependency-cruiser`, `no-cross-module-deep-import`). Реализация — тонкая
 * обёртка (`infrastructure/adapters/orders-facade.adapter.ts`, будущий тикет, начиная с
 * DTJ-243) поверх реального `modules/orders` → `OrdersFacade`
 * (`application/orders.facade.ts`, EP-09, DTJ-222/227) — сигнатуры здесь ЗЕРКАЛЬНЫ реальному
 * фасаду (`tenantId` первым параметром, опциональный непрозрачный `tx`), но используют
 * ТОЛЬКО примитивы/локальные типы `payments`, никогда доменные VO `orders` (тот же приём, что
 * `modules/orders/application/ports/payment-invoice.port.ts` на стороне `orders`).
 *
 * `tenantId` — первый обязательный параметр КАЖДОГО метода (правило 3 задания, SRS-API-043/046):
 * чужой тенант обязан вести себя как «заказа не существует» (404), не «доступ запрещён» (403).
 *
 * На момент этого тикета порт НЕ забинжен ни к одному адаптеру (см. `payments.module.ts`) —
 * связывается use case'ом, который его реально вызывает (`HandlePaymentWebhookUseCase`,
 * DTJ-243; `CancelOrderUseCase`-эквивалент со стороны payments, если потребуется).
 */

/** DI-токен для провайдера `PaymentsOrdersPort`. */
export const PAYMENTS_ORDERS_PORT = Symbol.for('@dorutj/payments/orders-facade')

/** Непрозрачный дескриптор активной транзакции (тот же паттерн, что `OrderUnitOfWorkTx` у `orders`). */
export type PaymentsUnitOfWorkTx = unknown

/**
 * Минимальный снэпшот заказа, нужный `payments` (SRS-PAY-018/020, §9 отмены). Поля — то
 * подмножество `Order`, которое `HandlePaymentWebhookUseCase`/`CaptureEscrowUseCase`/
 * `RefundOrderUseCase` реально читают для проверки инвариантов ДО мутации (D-25: `cash_courier`
 * никогда не имеет `escrow_ledger`-записей, §4.6) — не полная проекция агрегата `Order`.
 */
export interface PaymentsOrderSnapshot {
  readonly id: string
  readonly tenantId: string
  readonly pharmacyId: string | null
  readonly status: string
  readonly paymentMethod: string
  readonly totalAmountDiram: bigint
  /**
   * ДОБАВЛЕНО (DTJ-248, аддитивно — не ломает существующих потребителей, их на момент правки
   * нет ни одного, см. `GetOrderLedgerQuery`). `pharmacies.chain_id` заказа (`orders.pharmacy_id
   * → pharmacies.chain_id`) — нужно `GetOrderLedgerQuery` для проверки «заказ принадлежит сети
   * pharmacy_admin» (`claims.chainId` из JWT, `21-module-orders-payments-escrow.md` §4.5): чужой
   * ТЕНАНТ уже даёт `null` на уровне `getOrderById` (404, SRS-API-046) — ЭТО поле нужно для
   * ВНУТРИтенантного случая (нейтральный тенант обслуживает НЕСКОЛЬКО сетей одновременно,
   * `26-module-tenancy-whitelabel.md` §«Транзитивный через chain_id»), где заказ той же строки
   * `tenants`, но чужой `pharmacy_chains` — 403, не 404 (SRS-NFR-009: внутритенантный IDOR).
   * `null`, если у заказа нет `pharmacyId` ИЛИ у аптеки нет `chainId` (независимая аптека).
   */
  readonly pharmacyChainId: string | null
  /**
   * ДОБАВЛЕНО (DTJ-244, аддитивно — та же оговорка, что `pharmacyChainId` выше). Нужно
   * `CaptureEscrowUseCase` для `Σ(order_items.platform_fee_diram)` (SRS-PAY-031) — см. «Риски»
   * тикета DTJ-244: «расширить сигнатуру порта, если текущая не возвращает позиции заказа
   * целиком». Минимальный снэпшот позиции — только поле, реально нужное потребителю на момент
   * этой правки (YAGNI — не полная проекция `OrderItem`).
   */
  readonly items: readonly PaymentsOrderItemSnapshot[]
}

/** См. JSDoc `PaymentsOrderSnapshot.items` (DTJ-244). */
export interface PaymentsOrderItemSnapshot {
  readonly platformFeeDiram: bigint
}

export interface PaymentsOrderActor {
  readonly userId: string
  readonly role: string
  /** `null` — действие системы/джобы (например, `PayoutSchedulerJob`), не человека. */
  readonly pharmacyId: string | null
}

export interface PaymentsOrdersPort {
  /** Чужой тенант ⇒ `null` (SRS-API-046: существование чужой строки не подтверждается). */
  getOrderById(
    tenantId: string,
    orderId: string,
    tx?: PaymentsUnitOfWorkTx,
  ): Promise<PaymentsOrderSnapshot | null>

  /**
   * `pending_payment → paid_escrow` (SRS-PAY-018, категорический запрет: единственный
   * легальный вызывающий код — `HandlePaymentWebhookUseCase`/`AdminPaymentOverrideUseCase`).
   *
   * КРИТИЧЕСКИЙ ИНВАРИАНТ (SRS-ORD-027a): вызывающий код ОБЯЗАН записать соответствующую
   * `EscrowLedger.recordHold()`-проводку В ТОЙ ЖЕ транзакции (`tx`), что и этот вызов —
   * `order.status === 'paid_escrow' ⟺ escrow_ledger непуст для этого orderId` держится
   * ТОЛЬКО если обе записи атомарны. Раздельные вызовы (сначала `markPaidEscrow`, потом,
   * ВНЕ транзакции, `EscrowLedger.append()`) нарушают инвариант при сбое между ними.
   */
  markPaidEscrow(
    tenantId: string,
    orderId: string,
    txId: string,
    paidAt: Date,
    tx?: PaymentsUnitOfWorkTx,
  ): Promise<void>

  /**
   * Отмена заказа со стороны `payments` (§9 «Отмены заказа», напр. `late_payment_after_
   * cancellation`, SRS-PAY-027, или `AdminPaymentOverrideUseCase`-эскалация). `reason` — тот
   * же канонический словарь `orders.cancel_reason`, что и `OrderCancelReason` (SRS-ORD-030) —
   * здесь `string`, не branded-тип `orders` (граница модуля, см. JSDoc файла); адаптер
   * обязан провалидировать значение перед делегированием реальному `OrdersFacade.cancel()`.
   */
  cancel(
    tenantId: string,
    orderId: string,
    reason: string,
    actor: PaymentsOrderActor,
    tx?: PaymentsUnitOfWorkTx,
  ): Promise<void>
}
