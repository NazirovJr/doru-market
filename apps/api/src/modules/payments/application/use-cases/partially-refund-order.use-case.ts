/**
 * `PartiallyRefundOrderUseCase` (EP-12, DTJ-304, SRS-PHT-022, D-10/SRS-DOM-162,
 * `21-module-orders-payments-escrow.md` §7.3) — денежный эффект подтверждённой частичной
 * сборки (`ResolvePartialFulfillmentUseCase`, `modules/orders`, `confirmed=true`, ЛЮБОЙ
 * `source`). Вызывается ЧЕРЕЗ `RefundFacadePort.refundPartialFulfillment` (`orders`-порт,
 * см. её JSDoc DISPUTED) — `orders` НИКОГДА не импортирует этот файл напрямую (`02` §1.2).
 *
 * СТРУКТУРА — 1:1 приём `RefundOrderUseCase` (DTJ-245, тот же модуль): cash-заказ — no-op
 * (эскроу для `cash_courier` не существует, D-25); идемпотентность — READ-FIRST по
 * `escrow_ledger` (тот же класс гарантии, не «истинная» защита от гонки — единственный
 * реальный вызывающий код, `ResolvePartialFulfillmentUseCase`, уже гарантирует «ровно один
 * реальный вызов» через `PartialFulfillmentRequestRepositoryPort.transitionStatus` CAS-переход
 * ДО вызова этого use case, см. её JSDoc — READ-FIRST здесь ТОЛЬКО защита retry-задачи п.5
 * тикета: `PAYMENT_PROVIDER_UNAVAILABLE` НЕ откатывает статус запроса, повторный вызов той же
 * retry-задачи ДОЛЖЕН быть безопасен, если первая попытка частично преуспела).
 *
 * ВЕТВЛЕНИЕ D-10 (буквально «Что сделать» п.3(в) тикета/SRS-PHT-022): `billingStrategy ===
 * 'split_items_delivery'` → «рефанд транзакции items_total» (SRS-RET-006: ПОЛНЫЙ `refund()`
 * ОДНОЙ из двух независимо проведённых транзакций, НЕ `partialRefund()`) — ЭТА ветка НЕ
 * реализована (бросает, см. `performRefund` ниже): `ResolveBillingStrategyService`
 * (`modules/orders`, DTJ-228, решение CTO D-EP09-33) СТРУКТУРНО никогда не производит
 * `split_items_delivery` в R1 (нет `payment_operations.billing_component`/
 * `tenant_settings.useSplitBilling` — та же инфраструктура, которой для этой же ветки не
 * хватает `RefundOnReturnResolvedUseCase.applySplitBilling`/`ReturnsPaymentsPort.refundItems`,
 * EP-11, DTJ-274 — реальной реализации там тоже нет). Реализовывать код, недостижимый ни одним
 * путём и непроверяемый ни одним реальным сценарием (единственный реально существующий провод
 * от checkout к заказу — `single_invoice`), означало бы гадать форму API, которого сегодня не
 * существует — прямое нарушение «не додумывай бизнес-правила» этого тикета. Единственная
 * РЕАЛЬНО достижимая (и единственная покрытая тест-планом тикета) ветка — «иначе»:
 * `single_invoice` (ВСЕГДА, D-EP09-33) — ПОЛНЫЙ `refund()` всей суммы hold'а +
 * `escrow_ledger.entry_type='adjustment'` на недополученную сумму (SRS-RET-008, «тот же путь,
 * что и для возвратов, переиспользуется без дублирования кода» — здесь: тот же ДЕНЕЖНЫЙ ПРИЁМ,
 * не тот же код, который живёт в другом модуле, `returns` — прямой импорт оттуда запрещён `02`
 * §1.1, переиспользуется РЕШЕНИЕ, не файл).
 *
 * **Учёт (баланс `EscrowLedger.isBalanced()`, DTJ-240):** записываются ДВЕ строки, не одна —
 * `partially_refunded` (кредит, `refundAmountDiram` — РЕАЛЬНО положенная клиенту сумма) +
 * `adjustment` (кредит, `holdAmount - refundAmountDiram` — то, что клиент ПОЛУЧИЛ вместе с
 * полным банковским `refund()`, хотя это принадлежит аптеке/платформе за уже предоставленный
 * товар/доставку; «клиент получает назад больше, чем должен был бы, разница фиксируется как
 * учётная корректировка... для сверки с аптекой при следующем payout», SRS-RET-008). Сумма
 * ДВУХ строк равна `holdAmount` — `hold_created = partially_refunded + adjustment` (заказ ещё
 * не доставлен, `platform_fee_captured`/`captured_to_pharmacy` появятся отдельно, DTJ-244, при
 * `markDelivered`), т.е. `isBalanced()` держится СРАЗУ после этого вызова, не только в
 * терминальном состоянии заказа.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import {
  PAYMENTS_ORDERS_PORT,
  type PaymentsOrdersPort,
} from '@/modules/payments/application/ports/orders-facade.port.js'
import { PAYMENT_PROVIDER_TOKEN, type PaymentProvider } from '@/modules/payments/application/ports/payment-provider.port.js'
import {
  ESCROW_LEDGER_REPOSITORY,
  type EscrowLedgerRepository,
} from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

const CASH_PAYMENT_METHOD = 'cash_courier'
const HOLD_ENTRY_TYPE = 'hold_created'
const PARTIALLY_REFUNDED_ENTRY_TYPE = 'partially_refunded'
const CREDIT_DIRECTION = 'credit'
const PARTIAL_REFUND_IDEMPOTENCY_KEY_PREFIX = 'partial-refund'
/** SRS-DOM-035/`AdjustmentRequiresReasonError` — системный actor, нет человека-инициатора (тот
 *  же приём, что `SYSTEM_ACTOR_ID` в `RefundOnReturnResolvedUseCase`/`pharmacy-suspension.controller.ts`). */
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'
const ADJUSTMENT_REASON =
  'D-10/SRS-RET-008: single_invoice full refund() over-refunded the customer by the amount still owed to the pharmacy (items still fulfilled + delivery) — recorded for reconciliation at the next payout, not re-charged to the customer.'
const ZERO_DIRAM = 0n

export interface PartiallyRefundOrderCommand {
  readonly tenantId: string
  readonly orderId: string
  /** = `order_partial_fulfillment_requests.refund_amount_diram` (снэпшот `orders`-модуля). */
  readonly refundAmountDiram: bigint
}

@Injectable()
export class PartiallyRefundOrderUseCase {
  // eslint-disable-next-line max-params -- 3 порта (PaymentsOrdersPort/PaymentProvider/EscrowLedgerRepository) + PINO_LOGGER, тот же приём, что RefundOrderUseCase (см. её JSDoc).
  constructor(
    @Inject(PAYMENTS_ORDERS_PORT) private readonly ordersPort: PaymentsOrdersPort,
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly paymentProvider: PaymentProvider,
    @Inject(ESCROW_LEDGER_REPOSITORY) private readonly escrowLedger: EscrowLedgerRepository,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async execute(cmd: PartiallyRefundOrderCommand): Promise<void> {
    const order = await this.ordersPort.getOrderById(cmd.tenantId, cmd.orderId)
    if (order === null) {
      throw new Error(
        `PartiallyRefundOrderUseCase: order ${cmd.orderId} not found for tenant ${cmd.tenantId} — invariant violation, caller must validate existence first.`,
      )
    }
    if (order.paymentMethod === CASH_PAYMENT_METHOD) {
      // D-25 — наличные никогда не доходят до эскроу, партия/доставка регулируются вне PaymentsFacade.
      this.logger.info({ orderId: cmd.orderId }, 'partial_refund_noop_cash_order')
      return
    }
    if (await this.alreadyProcessed(cmd.tenantId, cmd.orderId)) {
      this.logger.info({ orderId: cmd.orderId }, 'partial_refund_noop_already_processed')
      return
    }

    await this.performRefund(cmd, order.billingStrategy)
  }

  private async alreadyProcessed(tenantId: string, orderId: string): Promise<boolean> {
    const refunded = await this.escrowLedger.sumByType(tenantId, orderId, PARTIALLY_REFUNDED_ENTRY_TYPE)
    return refunded > ZERO_DIRAM
  }

  private async performRefund(cmd: PartiallyRefundOrderCommand, billingStrategy: 'single_invoice' | 'split_items_delivery'): Promise<void> {
    if (billingStrategy === 'split_items_delivery') {
      // См. JSDoc файла — структурно недостижимо в R1 (D-EP09-33), нет инфраструктуры для
      // изоляции items-транзакции. Бросает — НЕ гадает форму частично реализованного API.
      throw new Error(
        'PartiallyRefundOrderUseCase: split_items_delivery is not supported — D-EP09-33 (ResolveBillingStrategyService never ' +
          'produces it in R1, no payment_operations.billing_component infrastructure exists to isolate the items-only transaction). ' +
          'See JSDoc for the rationale — coordinate with the EP-10/EP-11 owner before implementing a parallel API.',
      )
    }

    const holdAmount = await this.escrowLedger.sumByType(cmd.tenantId, cmd.orderId, HOLD_ENTRY_TYPE)
    const providerRef = await this.resolveHoldProviderRef(cmd.tenantId, cmd.orderId)

    const refundResult = await this.paymentProvider.refund(providerRef, deriveIdempotencyKey(cmd.orderId))
    if (!refundResult.ok) {
      throw refundResult.error
    }

    await this.appendPartiallyRefundedEntry(cmd, refundResult.value.providerRefundRef)
    await this.appendAdjustmentIfNeeded(cmd, holdAmount)
  }

  private async appendPartiallyRefundedEntry(cmd: PartiallyRefundOrderCommand, providerRefundRef: string): Promise<void> {
    await this.escrowLedger.append(
      EscrowLedgerEntry.create({
        orderId: cmd.orderId,
        entryType: PARTIALLY_REFUNDED_ENTRY_TYPE,
        direction: CREDIT_DIRECTION,
        amountDiram: Money.fromDiram(cmd.refundAmountDiram),
        paymentTransactionRef: providerRefundRef,
        reason: null,
        actorUserId: null,
      }),
    )
    this.logger.info(
      { orderId: cmd.orderId, refundAmountDiram: cmd.refundAmountDiram.toString() },
      'partial_refund_issued',
    )
  }

  /** См. JSDoc файла «Учёт» — недополученная аптекой/платформой сумма, `> 0` (Money запрещает `0`). */
  private async appendAdjustmentIfNeeded(cmd: PartiallyRefundOrderCommand, holdAmount: bigint): Promise<void> {
    const adjustmentAmount = holdAmount - cmd.refundAmountDiram
    if (adjustmentAmount <= ZERO_DIRAM) {
      return
    }
    await this.escrowLedger.append(
      EscrowLedgerEntry.create({
        orderId: cmd.orderId,
        entryType: 'adjustment',
        direction: CREDIT_DIRECTION,
        amountDiram: Money.fromDiram(adjustmentAmount),
        paymentTransactionRef: null,
        reason: ADJUSTMENT_REASON,
        actorUserId: SYSTEM_ACTOR_ID,
      }),
    )
  }

  /** См. JSDoc `RefundOrderUseCase.resolveHoldProviderRef` (тот же приём, 1:1). */
  private async resolveHoldProviderRef(tenantId: string, orderId: string): Promise<string> {
    const entries = await this.escrowLedger.findByOrderId(tenantId, orderId)
    const holdEntry = entries.find((entry) => entry.entryType === HOLD_ENTRY_TYPE)
    if (holdEntry?.paymentTransactionRef == null) {
      throw new Error(
        `PartiallyRefundOrderUseCase: missing '${HOLD_ENTRY_TYPE}' escrow entry with paymentTransactionRef for order ${orderId} — invariant violation.`,
      )
    }
    return holdEntry.paymentTransactionRef
  }
}

/** Детерминирован по `orderId` — «частичный рефанд» тоже одна логическая попытка на заказ (см. JSDoc файла про READ-FIRST). */
function deriveIdempotencyKey(orderId: string): string {
  return `${PARTIAL_REFUND_IDEMPOTENCY_KEY_PREFIX}:${orderId}`
}
