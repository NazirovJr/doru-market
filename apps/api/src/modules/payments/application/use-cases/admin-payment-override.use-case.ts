/**
 * `AdminPaymentOverrideUseCase` (EP-10, DTJ-246, SRS-PAY-018) — ЕДИНСТВЕННОЕ разрешённое
 * исключение из категорического запрета `HandlePaymentWebhookUseCase` (DTJ-242): банк
 * подтвердил оплату по телефону поддержки, вебхук технически не дошёл. Использует ТЕ ЖЕ
 * доменные операции, что DTJ-242 шаг 5 (`order.markPaidEscrow` + `EscrowLedger.append(hold_
 * created)`, ОДНА транзакция), но БЕЗ HMAC — заменена ролью (`super_admin`) + обязательным
 * `reason`. Второй вход (`admin`-роут, DTJ-356) — тот же use case, не второй домен-путь.
 *
 * Роль-проверка — ДВА рубежа (C12/defense-in-depth): presentation-guard (`@Roles('super_admin')`,
 * `admin-payment-override.controller.ts`) — ОСНОВНОЙ; `actorRole` в команде — ВТОРОЙ, на случай
 * прямого вызова use case в обход presentation (тестовый сценарий AC3 тикета, буквальный текст:
 * «вызывается напрямую в обход presentation-guard»). Дублирование НАМЕРЕННОЕ, не забытая правка.
 *
 * `audit_log` — ПЕРЕСМОТРЕНО (DTJ-356): запись теперь ВНУТРИ транзакции markPaidEscrow/ledger —
 * сбой откатывает всё (была best-effort после коммита, заменено сознательно по решению координатора).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ForbiddenError, NotFoundError, ValidationError } from '@dorutj/contracts'
import {
  ESCROW_LEDGER_REPOSITORY,
  type EscrowLedgerRepository,
} from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import {
  PAYMENTS_ORDERS_PORT,
  type PaymentsOrdersPort,
  type PaymentsUnitOfWorkTx,
} from '@/modules/payments/application/ports/orders-facade.port.js'
import {
  PAYMENTS_UNIT_OF_WORK,
  type PaymentsUnitOfWorkPort,
} from '@/modules/payments/application/ports/payments-unit-of-work.port.js'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/modules/payments/application/ports/audit-log.port.js'
import { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

const SUPER_ADMIN_ROLE = 'super_admin'
const OVERRIDE_ACTION = 'admin_payment_override'
const TARGET_STATUS = 'paid_escrow'

export interface AdminPaymentOverrideCommand {
  readonly tenantId: string
  readonly orderId: string
  readonly txId: string
  readonly amountDiram: bigint
  readonly paidAt: Date
  readonly reason: string
  readonly actorUserId: string
  readonly actorRole: string
  readonly requestId?: string | null
}

@Injectable()
export class AdminPaymentOverrideUseCase {
  private readonly alertLogger = new Logger(AdminPaymentOverrideUseCase.name)

  // eslint-disable-next-line max-params -- 4 порта (OrdersPort/EscrowLedger/AuditLog/UnitOfWork) — тот же класс состава, что соседние use case модуля (RefundOrderUseCase и т.п.).
  constructor(
    @Inject(PAYMENTS_ORDERS_PORT) private readonly ordersPort: PaymentsOrdersPort,
    @Inject(ESCROW_LEDGER_REPOSITORY) private readonly ledgerRepository: EscrowLedgerRepository,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(PAYMENTS_UNIT_OF_WORK) private readonly unitOfWork: PaymentsUnitOfWorkPort,
  ) {}

  async execute(cmd: AdminPaymentOverrideCommand): Promise<void> {
    if (cmd.actorRole !== SUPER_ADMIN_ROLE) {
      throw new ForbiddenError('AdminPaymentOverrideUseCase requires super_admin actor', { actorRole: cmd.actorRole })
    }
    if (isBlankReason(cmd.reason)) {
      throw new ValidationError('AdminPaymentOverrideUseCase requires a non-empty reason', { orderId: cmd.orderId })
    }

    await this.unitOfWork.run((tx) => this.applyOverrideAndAudit(cmd, tx))
    this.alertOnCall(cmd)
  }

  private async applyOverrideAndAudit(cmd: AdminPaymentOverrideCommand, tx: PaymentsUnitOfWorkTx): Promise<void> {
    const order = await this.ordersPort.getOrderById(cmd.tenantId, cmd.orderId, tx)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    const statusFrom = order.status
    await this.ordersPort.markPaidEscrow(cmd.tenantId, cmd.orderId, cmd.txId, cmd.paidAt, tx)
    await this.ledgerRepository.append(
      EscrowLedgerEntry.create({
        orderId: cmd.orderId,
        entryType: 'hold_created',
        direction: 'debit',
        amountDiram: Money.fromDiram(cmd.amountDiram),
        paymentTransactionRef: cmd.txId,
        reason: null,
        actorUserId: null,
      }),
      tx,
    )
    await this.auditLog.appendPaymentOverride(
      {
        tenantId: cmd.tenantId,
        entityId: cmd.orderId,
        action: OVERRIDE_ACTION,
        metadata: {
          orderId: cmd.orderId,
          amountDiram: cmd.amountDiram.toString(),
          txId: cmd.txId,
          statusFrom,
          statusTo: TARGET_STATUS,
          orderTotalDiram: Number(order.totalAmountDiram),
        },
        reason: cmd.reason,
        actorUserId: cmd.actorUserId,
        requestId: cmd.requestId ?? null,
      },
      tx,
    )
  }

  /** TODO(EP-observability, не тикетирован): реальный канал алертинга дежурному (Slack/PagerDuty)
   * не заведён ни одним эпиком — деградация до `Logger.fatal` (DoD тикета допускает явный TODO). */
  private alertOnCall(cmd: AdminPaymentOverrideCommand): void {
    this.alertLogger.fatal(
      `AdminPaymentOverrideUseCase: super_admin ${cmd.actorUserId} overrode payment for order ${cmd.orderId} — reason: ${cmd.reason}`,
    )
  }
}

function isBlankReason(reason: string): boolean {
  return reason.trim().length === 0
}
