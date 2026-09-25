/**
 * `RefundOnReturnResolvedUseCase` (EP-11, DTJ-274, SRS-RET-004/006..010). Подписчик на
 * `ReturnConfirmedEvent` (см. `refund-on-return-resolved.subscriber.ts` — `ReturnRejectedEvent`
 * НЕ триггерит рефанд, деньги не возвращаются за отклонённый возврат). Единственная точка,
 * где деньги реально двигаются в модуле `returns` — ошибка здесь либо не вернёт клиенту деньги
 * за брак, либо вернёт больше денег, чем положено, без фиксации разницы.
 *
 * `billingStrategy`/суммы читаются из `OrderReturnContext` (снэпшот заказа на момент checkout,
 * SRS-RET-009 — НЕ пересчитывается по текущему `tenant_settings.useSplitBilling`).
 *
 * Деньги ходят ТОЛЬКО через `ReturnsPaymentsPort` (DTJ-270) — прямой импорт `modules/payments/**`
 * отсюда запрещён (`dependency-cruiser`). Реализация порта — `PaymentsFacadeAdapter`
 * (`infrastructure/adapters/payments-facade.adapter.ts`).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { isErr } from '@dorutj/domain-kernel'
import type { ReturnReason as ReturnReasonValue, ReturnDisposition as ReturnDispositionValue } from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { ReturnReason, ReturnDisposition } from '../../domain/index.js'
import { RETURNS_ORDERS_PORT, type ReturnsOrdersPort, type OrderReturnContext } from '../ports/orders-facade.port.js'
import { RETURNS_PAYMENTS_PORT, type ReturnsPaymentsPort } from '../ports/payments-facade.port.js'
import { PROCESSED_EVENTS_PORT, type ProcessedEventsPort } from '@/common/events/processed-events.port.js'
import { RETURNS_UNIT_OF_WORK, type ReturnsUnitOfWorkPort, type ReturnsUnitOfWorkCallback } from '../ports/returns-unit-of-work.port.js'
import type { ReturnsUnitOfWorkTx } from '../ports/orders-facade.port.js'
import { ReturnFinancialOutcomeResolver } from '../policies/return-financial-outcome.policy.js'
import type { ReturnFinancialOutcome } from '../policies/return-financial-outcome.types.js'

const CONSUMER_NAME = 'returns.on-resolved'
const CASH_PAYMENT_METHOD = 'cash_courier'
/** Системный actor для автоматической `escrow_ledger.adjustment`-записи (SRS-RET-008) — нет
 *  человека-инициатора, тот же приём, что `SYSTEM_ACTOR_ID` в `pharmacy-suspension.controller.ts`. */
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

export interface RefundOnReturnResolvedCommand {
  readonly tenantId: string
  readonly returnId: string
  readonly orderId: string
  readonly reason: ReturnReasonValue
  readonly disposition: ReturnDispositionValue
  /** `outbox.id` строки, доставившей событие — ключ идемпотентности (`ProcessedEventsPort`, SRS-DOM-152). */
  readonly eventId: string
}

@Injectable()
export class RefundOnReturnResolvedUseCase {
  // eslint-disable-next-line max-params -- явный @Inject на каждом порте, см. CaptureEscrowUseCase JSDoc (payments-модуль, тот же приём).
  public constructor(
    @Inject(PROCESSED_EVENTS_PORT) private readonly processedEvents: ProcessedEventsPort,
    @Inject(RETURNS_ORDERS_PORT) private readonly ordersPort: ReturnsOrdersPort,
    @Inject(RETURNS_PAYMENTS_PORT) private readonly paymentsPort: ReturnsPaymentsPort,
    @Inject(RETURNS_UNIT_OF_WORK) private readonly unitOfWork: ReturnsUnitOfWorkPort,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
    @Inject(ReturnFinancialOutcomeResolver) private readonly financialOutcomeResolver: ReturnFinancialOutcomeResolver,
  ) {}

  public async execute(command: RefundOnReturnResolvedCommand): Promise<void> {
    const run: ReturnsUnitOfWorkCallback<void> = (tx) => this.processWithinTransaction(command, tx)
    await this.unitOfWork.run(run)
  }

  private async processWithinTransaction(command: RefundOnReturnResolvedCommand, tx: ReturnsUnitOfWorkTx): Promise<void> {
    const isNew = await this.processedEvents.markProcessed(CONSUMER_NAME, command.eventId, tx)
    if (!isNew) {
      return // SRS-DOM-152 — at-least-once, это событие уже обработано (возможно, override + confirm подряд).
    }
    const order = await this.ordersPort.getOrderForReturn(command.tenantId, command.orderId, tx)
    if (order === null) {
      throw new Error(
        `RefundOnReturnResolvedUseCase: order ${command.orderId} not found for tenant ${command.tenantId} — invariant violation.`,
      )
    }
    if (order.paymentMethod === CASH_PAYMENT_METHOD) {
      // SRS-RET-010/REQ-RET-10 — эскроу-леджера для наличных нет, физический возврат — вне PaymentsFacade.
      this.logger.info({ returnId: command.returnId, orderId: command.orderId }, 'refund_on_return_resolved_noop_cash_order')
      return
    }
    const outcome = this.resolveOutcome(command)
    await this.applyOutcome({ command, order, outcome, tx })
  }

  private resolveOutcome(command: RefundOnReturnResolvedCommand): ReturnFinancialOutcome {
    const reason = ReturnReason.fromTrusted(command.reason)
    const dispositionResult = ReturnDisposition.parse(command.disposition)
    if (isErr(dispositionResult)) {
      // Недостижимо в проде: `disposition` пришёл из `ReturnConfirmedEvent`, уже валидного enum-значения.
      throw dispositionResult.error
    }
    return this.financialOutcomeResolver.resolve(reason, dispositionResult.value)
  }

  private async applyOutcome(input: ApplyOutcomeInput): Promise<void> {
    if (input.order.billingStrategy === 'split_items_delivery') {
      await this.applySplitBilling(input)
      return
    }
    await this.applySingleInvoice(input)
  }

  /** SRS-RET-007 — `refundByComponent` для КАЖДОЙ части с `*Refund === 'full'`, ПОЛНЫЙ refund той части, delivery не задета, если не положена. */
  private async applySplitBilling({ command, order, outcome, tx }: ApplyOutcomeInput): Promise<void> {
    const base = { orderId: command.orderId, returnId: command.returnId }
    if (outcome.itemsRefund === 'full') {
      await this.paymentsPort.refundItems(command.tenantId, { ...base, amountDiram: order.itemsTotalDiram }, tx)
    }
    if (outcome.deliveryFeeRefund === 'full') {
      await this.paymentsPort.refundDelivery(command.tenantId, { ...base, amountDiram: order.deliveryFeeDiram }, tx)
    }
  }

  /**
   * SRS-RET-008 — `single_invoice`, `supportsPartialRefund=false` (MVP-дефолт ВСЕХ адаптеров):
   * `itemsRefund='full' && deliveryFeeRefund='full'` → простой полный возврат (п.6 тикета).
   * `itemsRefund='full' && deliveryFeeRefund='none'` → ВСЁ РАВНО полный возврат (провайдер не
   * умеет частично) + `adjustment` на `deliveryFeeDiram` — недополученная аптекой сумма,
   * фиксируется для сверки при следующем payout, НЕ довзыскивается с клиента.
   * `itemsRefund='none' && deliveryFeeRefund='none'` (NO_REFUND, `customer_dispute_post_delivery`
   * с `disposition≠restock`) — денег клиенту не положено, порт не вызывается вовсе.
   * Комбинация `itemsRefund='none' && deliveryFeeRefund='full'` НЕДОСТИЖИМА (`ReturnFinancialOutcomeResolver`,
   * DTJ-272, не производит такую пару) — не обрабатывается веткой отдельно, `else`-случай ниже
   * покрывает её явным `throw`, чтобы будущее изменение резолвера не прошло здесь молча.
   */
  private async applySingleInvoice({ command, order, outcome, tx }: ApplyOutcomeInput): Promise<void> {
    const base = { orderId: command.orderId, returnId: command.returnId }
    if (outcome.itemsRefund === 'full' && outcome.deliveryFeeRefund === 'full') {
      await this.paymentsPort.refundFull(command.tenantId, { ...base, amountDiram: order.totalAmountDiram }, tx)
      return
    }
    if (outcome.itemsRefund === 'full' && outcome.deliveryFeeRefund === 'none') {
      await this.paymentsPort.refundFull(command.tenantId, { ...base, amountDiram: order.totalAmountDiram }, tx)
      await this.paymentsPort.recordAdjustment(
        command.tenantId,
        {
          ...base,
          amountDiram: order.deliveryFeeDiram,
          reason: 'single_invoice full refund included a non-refundable delivery fee (SRS-RET-008)',
          actorUserId: SYSTEM_ACTOR_ID,
        },
        tx,
      )
      return
    }
    if (outcome.itemsRefund === 'none' && outcome.deliveryFeeRefund === 'none') {
      return // NO_REFUND — деньги клиенту не положены, порт не вызывается.
    }
    // Недостижимо: см. JSDoc метода — `ReturnFinancialOutcomeResolver` не производит (none, full).
    throw new Error(
      `RefundOnReturnResolvedUseCase: unexpected ReturnFinancialOutcome combination (${outcome.itemsRefund}, ${outcome.deliveryFeeRefund}) — invariant violation.`,
    )
  }
}

/** Извлечено из сигнатур `applyOutcome`/`applySplitBilling`/`applySingleInvoice` — C1 (`max-params`, порог 3). */
interface ApplyOutcomeInput {
  readonly command: RefundOnReturnResolvedCommand
  readonly order: OrderReturnContext
  readonly outcome: ReturnFinancialOutcome
  readonly tx: ReturnsUnitOfWorkTx
}
