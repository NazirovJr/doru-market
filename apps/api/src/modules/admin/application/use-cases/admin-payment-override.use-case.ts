// Обёртка над уже существующим payments/AdminPaymentOverrideUseCase (DTJ-246) — тот остаётся
// единственным вызывающим Order.markPaidEscrow() (SRS-PAY-018), это лишь второй вход в него.
// Наш audit.write() ниже — НЕ атомарен с этой мутацией (см. отчёт сдачи DTJ-356: блокер AC2/AC4).
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError, ValidationError } from '@dorutj/contracts'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { ORDERS_FACADE_PORT, type OrderAdminDetailView, type OrdersFacadePort } from '../ports/orders-facade.port.js'
import { PAYMENTS_FACADE_PORT, type PaymentsFacadePort } from '../ports/payments-facade.port.js'

const MIN_REASON_LENGTH = 10
const PAYMENT_OVERRIDE_AUDIT_CATEGORY = 'payment_override'
const PAYMENT_OVERRIDE_ACTION = 'admin_payment_override'
const ORDER_ENTITY_TYPE = 'order'
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
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
  ) {}

  public async execute(cmd: AdminPaymentOverrideCommand): Promise<AdminPaymentOverrideResult> {
    this.assertReason(cmd.reason, cmd.orderId)
    const order = await this.findOrderOrThrow(cmd.orderId)
    const statusFrom = order.status

    await this.paymentsFacade.adminPaymentOverride({
      tenantId: order.tenantId,
      orderId: cmd.orderId,
      txId: cmd.txId,
      amountDiram: cmd.amountDiram,
      paidAt: cmd.paidAt,
      reason: cmd.reason,
      actorUserId: cmd.actor.userId,
      actorRole: cmd.actor.role,
    })

    await this.auditLog.write({
      category: PAYMENT_OVERRIDE_AUDIT_CATEGORY,
      entityType: ORDER_ENTITY_TYPE,
      entityId: cmd.orderId,
      actorUserId: cmd.actor.userId,
      action: PAYMENT_OVERRIDE_ACTION,
      reason: cmd.reason,
      metadata: {
        before: { status: statusFrom },
        after: { status: TARGET_STATUS },
        extra: { orderTotalDiram: order.totalAmountDiram },
      },
      requestId: cmd.requestId,
      tenantId: order.tenantId,
    })

    return { orderId: cmd.orderId, status: TARGET_STATUS }
  }

  private assertReason(reason: string, orderId: string): void {
    if (reason.trim().length < MIN_REASON_LENGTH) {
      throw new ValidationError('reason must be at least 10 characters', { orderId })
    }
  }

  private async findOrderOrThrow(orderId: string): Promise<OrderAdminDetailView> {
    const order = await this.ordersFacade.getOrderDetail(orderId)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId })
    }
    return order
  }
}
