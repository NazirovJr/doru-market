/**
 * `PaymentsFacadeAdapter` — реализация `ReturnsPaymentsPort` поверх `PaymentsFacade`.
 * `tx` не форвардится дальше: платёжные use case'ы намеренно не держат транзакцию через вызов
 * провайдера (см. `RefundOrderUseCase`) — идемпотентность обеспечена на уровне события и ledger.
 */
import { Inject, Injectable } from '@nestjs/common'
import { PAYMENTS_FACADE, type PaymentsFacade } from '@/modules/payments/index.js'
import type {
  ReturnsPaymentsPort,
  ReturnsRefundItemsCommand,
  ReturnsRefundDeliveryCommand,
  ReturnsRefundFullCommand,
  ReturnsRecordAdjustmentCommand,
} from '@/modules/returns/application/ports/payments-facade.port.js'

// split_items_delivery структурно недостижим в R1 (D-EP09-33), тот же вывод, что PartiallyRefundOrderUseCase.
const SPLIT_BILLING_UNSUPPORTED_MESSAGE =
  'PaymentsFacadeAdapter: split_items_delivery billing is not supported in R1 (D-EP09-33), same conclusion as PartiallyRefundOrderUseCase.'

function deriveReturnRefundReason(returnId: string): string {
  return `return_confirmed:${returnId}`
}

@Injectable()
export class PaymentsFacadeAdapter implements ReturnsPaymentsPort {
  public constructor(@Inject(PAYMENTS_FACADE) private readonly paymentsFacade: PaymentsFacade) {}

  public refundItems(_tenantId: string, _command: ReturnsRefundItemsCommand): Promise<void> {
    return Promise.reject(new Error(SPLIT_BILLING_UNSUPPORTED_MESSAGE))
  }

  public refundDelivery(_tenantId: string, _command: ReturnsRefundDeliveryCommand): Promise<void> {
    return Promise.reject(new Error(SPLIT_BILLING_UNSUPPORTED_MESSAGE))
  }

  public async refundFull(tenantId: string, command: ReturnsRefundFullCommand): Promise<void> {
    await this.paymentsFacade.refundFull(tenantId, {
      orderId: command.orderId,
      reason: deriveReturnRefundReason(command.returnId),
    })
  }

  public async recordAdjustment(_tenantId: string, command: ReturnsRecordAdjustmentCommand): Promise<void> {
    await this.paymentsFacade.recordAdjustment({
      orderId: command.orderId,
      amountDiram: command.amountDiram,
      reason: command.reason,
      actorUserId: command.actorUserId,
    })
  }
}
