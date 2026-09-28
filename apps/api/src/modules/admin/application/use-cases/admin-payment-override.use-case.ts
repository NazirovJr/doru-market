// Обёртка над payments/AdminPaymentOverrideUseCase — тот остаётся единственным вызывающим
// Order.markPaidEscrow() и сам пишет атомарный audit_log; здесь второй вход, не второй audit.
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError, ValidationError } from '@dorutj/contracts'
import { ORDERS_FACADE_PORT, type OrdersFacadePort } from '../ports/orders-facade.port.js'
import { PAYMENTS_FACADE_PORT, type PaymentsFacadePort } from '../ports/payments-facade.port.js'

const MIN_REASON_LENGTH = 10
const TARGET_STATUS = 'paid_escrow'

export interface AdminPaymentOverrideActor {
  readonly userId: string
  readonly role: string
}

export interface AdminPaymentOverrideCommand {
  readonly orderId: string
  readonly reason: string
  readonly txId: string
  readonly amountDiram: bigint
  readonly paidAt: Date
  readonly actor: AdminPaymentOverrideActor
  readonly requestId: string | null
}

export interface AdminPaymentOverrideResult {
  readonly orderId: string
  readonly status: typeof TARGET_STATUS
}

@Injectable()
export class AdminPaymentOverrideUseCase {
  public constructor(
    @Inject(ORDERS_FACADE_PORT) private readonly ordersFacade: OrdersFacadePort,
    @Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort,
  ) {}

  public async execute(cmd: AdminPaymentOverrideCommand): Promise<AdminPaymentOverrideResult> {
    this.assertReason(cmd.reason, cmd.orderId)
    // Кросс-тенантный резолвинг tenantId (super_admin) — payments-модуль сам не умеет искать заказ без tenantId.
    const order = await this.ordersFacade.getOrderDetail(cmd.orderId)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }

    await this.paymentsFacade.adminPaymentOverride({
      tenantId: order.tenantId,
      orderId: cmd.orderId,
      txId: cmd.txId,
      amountDiram: cmd.amountDiram,
      paidAt: cmd.paidAt,
      reason: cmd.reason,
      actorUserId: cmd.actor.userId,
      actorRole: cmd.actor.role,
      requestId: cmd.requestId,
    })

    return { orderId: cmd.orderId, status: TARGET_STATUS }
  }

  private assertReason(reason: string, orderId: string): void {
    if (reason.trim().length < MIN_REASON_LENGTH) {
      throw new ValidationError('reason must be at least 10 characters', { orderId })
    }
  }
}
