// Обёртка над существующим Order.cancel() — НЕ одноимённый доменный use case orders/payments.
// audit.write() — последний шаг unitOfWork.run: бросит — cancel() ещё не закоммичен, откатится вместе с ним.
import { Inject, Injectable } from '@nestjs/common'
import {
  BusinessRuleViolationError,
  ForbiddenError,
  InvalidOrderStatusTransitionError,
  NotFoundError,
  ValidationError,
} from '@dorutj/contracts'
import { AUDIT_LOG_PORT, type AuditEntryInput, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/modules/auth/index.js'
import {
  ADMIN_FORCE_CANCEL_ORDER_REASON,
  ORDERS_FACADE_PORT,
  type OrderAdminDetailView,
  type OrdersFacadePort,
} from '../ports/orders-facade.port.js'
import { PAYMENTS_FACADE_PORT, type PaymentsFacadePort } from '../ports/payments-facade.port.js'

const SUPER_ADMIN_ROLE = 'super_admin'
const MIN_REASON_LENGTH = 10
const CASH_COURIER_METHOD = 'cash_courier'
const REFUND_REQUIRED_STATUSES = new Set<string>(['paid_escrow', 'processing'])
const FORCE_CANCEL_AUDIT_CATEGORY = 'force_cancel_order'
const FORCE_CANCEL_ACTION = 'admin_force_cancel_order'
const ORDER_ENTITY_TYPE = 'order'

export interface AdminForceCancelOrderActor {
  readonly userId: string
  readonly role: string
}

export interface AdminForceCancelOrderCommand {
  readonly orderId: string
  readonly reason: string
  readonly actor: AdminForceCancelOrderActor
  readonly requestId: string | null
}

export interface AdminForceCancelOrderResult {
  readonly orderId: string
  readonly status: 'cancelled'
  readonly refundIssued: boolean
}

@Injectable()
export class AdminForceCancelOrderUseCase {
  // eslint-disable-next-line max-params -- 4 порта (Orders/Payments facade + AuditLog + UnitOfWork), тот же состав, что GetOrderDetailAdminUseCase/AdminPaymentOverrideUseCase.
  public constructor(
    @Inject(ORDERS_FACADE_PORT) private readonly ordersFacade: OrdersFacadePort,
    @Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  public async execute(cmd: AdminForceCancelOrderCommand): Promise<AdminForceCancelOrderResult> {
    this.assertActor(cmd.actor)
    this.assertReason(cmd.reason, cmd.orderId)
    const order = await this.findOrderOrThrow(cmd.orderId)

    await this.unitOfWork.run(async (tx) => {
      await this.cancelOrThrow(order, cmd, tx)
      await this.auditLog.write(this.buildAuditEntry(order, cmd))
    })

    const refundIssued = await this.refundIfNeeded(order, cmd.reason)
    return { orderId: cmd.orderId, status: 'cancelled', refundIssued }
  }

  private assertActor(actor: AdminForceCancelOrderActor): void {
    if (actor.role !== SUPER_ADMIN_ROLE) {
      throw new ForbiddenError('AdminForceCancelOrderUseCase requires super_admin actor', { actorRole: actor.role })
    }
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

  private async cancelOrThrow(order: OrderAdminDetailView, cmd: AdminForceCancelOrderCommand, tx: unknown): Promise<void> {
    try {
      await this.ordersFacade.cancel(
        cmd.orderId,
        {
          tenantId: order.tenantId,
          reason: ADMIN_FORCE_CANCEL_ORDER_REASON,
          actor: { kind: 'user', userId: cmd.actor.userId },
          now: new Date(),
        },
        tx,
      )
    } catch (error) {
      if (error instanceof InvalidOrderStatusTransitionError) {
        // Переклассификация в 422 (не 409) — для этого эндпоинта это бизнес-правило, не деталь состояния.
        throw new BusinessRuleViolationError('Order cannot be force-cancelled in its current status', {
          orderId: cmd.orderId,
          status: order.status,
        })
      }
      throw error
    }
  }

  private buildAuditEntry(order: OrderAdminDetailView, cmd: AdminForceCancelOrderCommand): AuditEntryInput {
    return {
      category: FORCE_CANCEL_AUDIT_CATEGORY,
      entityType: ORDER_ENTITY_TYPE,
      entityId: cmd.orderId,
      actorUserId: cmd.actor.userId,
      action: FORCE_CANCEL_ACTION,
      reason: cmd.reason,
      metadata: {
        before: { status: order.status },
        after: { status: 'cancelled' },
        extra: { orderTotalDiram: order.totalAmountDiram },
      },
      requestId: cmd.requestId,
      tenantId: order.tenantId,
    }
  }

  private async refundIfNeeded(order: OrderAdminDetailView, reason: string): Promise<boolean> {
    const refundRequired = order.paymentMethod !== CASH_COURIER_METHOD && REFUND_REQUIRED_STATUSES.has(order.status)
    if (refundRequired) {
      await this.paymentsFacade.refundFull(order.tenantId, { orderId: order.id, reason })
    }
    return refundRequired
  }
}
