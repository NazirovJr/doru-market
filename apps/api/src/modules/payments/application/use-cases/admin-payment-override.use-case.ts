/**
 * `AdminPaymentOverrideUseCase` (EP-10, DTJ-246, SRS-PAY-018) — ЕДИНСТВЕННОЕ разрешённое
 * исключение из категорического запрета `HandlePaymentWebhookUseCase` (DTJ-242): банк
 * подтвердил оплату по телефону поддержки, вебхук технически не дошёл. Использует ТЕ ЖЕ
 * доменные операции, что DTJ-242 шаг 5 (`order.markPaidEscrow` + `EscrowLedger.append(hold_
 * created)`, ОДНА транзакция), но БЕЗ HMAC — заменена ролью (`super_admin`) + обязательным
 * `reason`.
 *
 * Роль-проверка — ДВА рубежа (C12/defense-in-depth): presentation-guard (`@Roles('super_admin')`,
 * `admin-payment-override.controller.ts`) — ОСНОВНОЙ; `actorRole` в команде — ВТОРОЙ, на случай
 * прямого вызова use case в обход presentation (тестовый сценарий AC3 тикета, буквальный текст:
 * «вызывается напрямую в обход presentation-guard»). Дублирование НАМЕРЕННОЕ, не забытая правка.
 *
 * `audit_log` — ОБЯЗАТЕЛЕН для КАЖДОГО вызова (DoD тикета: «нет пути выполнения без неё») —
 * пишется ПОСЛЕ успешной транзакции (та же граница, что `LatePaymentRefundService.
 * createSystemAutoTicketBestEffort`, DTJ-243 — административное событие, не денежный факт,
 * сбой записи audit_log НЕ должен откатывать уже совершённый override, но алерт дежурному
 * гарантирует, что событие не останется незамеченным даже при сбое audit_log).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ForbiddenError, ValidationError } from '@dorutj/contracts'
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

export interface AdminPaymentOverrideCommand {
  readonly tenantId: string
  readonly orderId: string
  readonly txId: string
  readonly amountDiram: bigint
  readonly paidAt: Date
  readonly reason: string
  readonly actorUserId: string
  readonly actorRole: string
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

    await this.unitOfWork.run((tx) => this.applyOverride(cmd, tx))

    await this.auditLog.appendPaymentOverride({
      tenantId: cmd.tenantId,
      entityId: cmd.orderId,
      action: OVERRIDE_ACTION,
      metadata: { orderId: cmd.orderId, amountDiram: cmd.amountDiram.toString(), txId: cmd.txId },
      reason: cmd.reason,
      actorUserId: cmd.actorUserId,
    })
    this.alertOnCall(cmd)
  }

  private async applyOverride(cmd: AdminPaymentOverrideCommand, tx: PaymentsUnitOfWorkTx): Promise<void> {
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
