/**
 * `LatePaymentRefundService` (EP-10, DTJ-243, SRS-PAY-027) — обрабатывает `payment_confirmed`,
 * прибывший ПОСЛЕ того, как заказ уже `cancelled` (например, `UnpaidOrderTimeoutJob`, DTJ-253,
 * отменил заказ за миллисекунды до того, как банк подтвердил оплату). Заказ ОСТАЁТСЯ
 * `cancelled` (SRS-DOM-102 терминален, `order.markPaidEscrow` НЕ вызывается) — но деньги реально
 * пришли, поэтому создаётся АУДИТОРСКИЙ след (`hold_created` + `refunded_to_customer`) и деньги
 * реально возвращаются клиенту (`PaymentProvider.refund`).
 *
 * ПОРЯДОК ОПЕРАЦИЙ (сознательное решение исполнителя, отличается от буквального порядка списка
 * тикета «hold_created + refunded_to_customer, ЗАТЕМ PaymentProvider.refund» — зафиксировано
 * в отчёте сдачи DTJ-243):
 *   1. `hold_created` (в `tx` вызывающего — см. `handle-payment-webhook.use-case.ts`
 *      `processWithinTransaction`) — документирует ФАКТ поступления денег, истинный независимо
 *      от исхода рефанда.
 *   2. `PaymentProvider.refund()` — Given `Err` → бросает, ВСЯ транзакция (включая идемпотентную
 *      строку `payment_operations` того же `tx`) откатывается — повторная доставка ТОГО ЖЕ
 *      `bankEventId` банком безопасно повторяет обработку с нуля (идемпотентность
 *      `payment_operations.idempotency_key` защищает только УСПЕШНО завершённые попытки).
 *   3. `refunded_to_customer` (тот же `tx`) — ТОЛЬКО если рефанд подтверждён.
 *   4. `support_tickets` — ВНЕ `tx` (админ-уведомление, не денежный факт; сбой создания тикета
 *      не должен откатывать уже совершённый рефанд — логируется, не бросает).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import {
  ESCROW_LEDGER_REPOSITORY,
  type EscrowLedgerRepository,
} from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import { PAYMENT_PROVIDER_TOKEN, type PaymentProvider } from '@/modules/payments/application/ports/payment-provider.port.js'
import type { PaymentsUnitOfWorkTx } from '@/modules/payments/application/ports/orders-facade.port.js'
import { SUPPORT_TICKET_PORT, type SupportTicketPort } from '@/modules/payments/application/ports/support-ticket.port.js'
import { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

const LATE_REFUND_IDEMPOTENCY_KEY_PREFIX = 'late-refund'
const HOLD_ENTRY_TYPE = 'hold_created'
const REFUNDED_ENTRY_TYPE = 'refunded_to_customer'
const DEBIT_DIRECTION = 'debit'
const CREDIT_DIRECTION = 'credit'
const LATE_PAYMENT_REASON = 'late_payment_after_cancellation'

export interface LatePaymentRefundInput {
  readonly tenantId: string
  readonly orderId: string
  readonly amountDiram: bigint
  /** `providerRef` исходного (позднего) платежа — тот, что несёт вебхук `payment_confirmed`. */
  readonly providerRef: string
}

@Injectable()
export class LatePaymentRefundService {
  // eslint-disable-next-line max-params -- 3 порта (EscrowLedgerRepository/PaymentProvider/SupportTicketPort) + PINO_LOGGER, тот же состав, что RefundOrderUseCase минус PaymentsOrdersPort/PayoutScheduleRepository (не нужны — заказ не в paid_escrow).
  constructor(
    @Inject(ESCROW_LEDGER_REPOSITORY) private readonly ledgerRepository: EscrowLedgerRepository,
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly paymentProvider: PaymentProvider,
    @Inject(SUPPORT_TICKET_PORT) private readonly supportTickets: SupportTicketPort,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async handle(input: LatePaymentRefundInput, tx: PaymentsUnitOfWorkTx): Promise<void> {
    await this.appendEntry({ input, entryType: HOLD_ENTRY_TYPE, direction: DEBIT_DIRECTION, reason: null, tx })

    const idempotencyKey = `${LATE_REFUND_IDEMPOTENCY_KEY_PREFIX}:${input.orderId}`
    const refundResult = await this.paymentProvider.refund(input.providerRef, idempotencyKey)
    if (!refundResult.ok) {
      throw refundResult.error
    }

    await this.appendEntry({ input, entryType: REFUNDED_ENTRY_TYPE, direction: CREDIT_DIRECTION, reason: LATE_PAYMENT_REASON, tx })
    await this.createSupportTicketBestEffort(input)
  }

  private async appendEntry(cmd: {
    readonly input: LatePaymentRefundInput
    readonly entryType: typeof HOLD_ENTRY_TYPE | typeof REFUNDED_ENTRY_TYPE
    readonly direction: typeof DEBIT_DIRECTION | typeof CREDIT_DIRECTION
    readonly reason: string | null
    readonly tx: PaymentsUnitOfWorkTx
  }): Promise<void> {
    await this.ledgerRepository.append(
      EscrowLedgerEntry.create({
        orderId: cmd.input.orderId,
        entryType: cmd.entryType,
        direction: cmd.direction,
        amountDiram: Money.fromDiram(cmd.input.amountDiram),
        paymentTransactionRef: cmd.input.providerRef,
        reason: cmd.reason,
        actorUserId: null,
      }),
      cmd.tx,
    )
  }

  /** Сбой создания тикета — best-effort (логируется, НЕ бросает): уже совершённый рефанд не откатывается. */
  private async createSupportTicketBestEffort(input: LatePaymentRefundInput): Promise<void> {
    try {
      await this.supportTickets.createSystemAutoTicket({
        tenantId: input.tenantId,
        orderId: input.orderId,
        category: 'payment_issue',
        description: `LatePaymentRefundService: payment_confirmed received after order cancellation (order ${input.orderId})`,
      })
    } catch (error) {
      this.logger.error({ orderId: input.orderId, err: error }, 'late_payment_refund_support_ticket_failed')
    }
  }
}
