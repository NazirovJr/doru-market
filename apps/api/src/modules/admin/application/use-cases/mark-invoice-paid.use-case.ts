// Категория audit_log — 'ledger_adjustment' (временное решение, спецификация не покрывает это действие; требует ADR архитектора).
import { Inject, Injectable } from '@nestjs/common'
import { BusinessRuleViolationError, ConflictError, NotFoundError } from '@dorutj/contracts'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/modules/auth/index.js'
import { PAYMENTS_FACADE_PORT, type BillingInvoiceView, type MarkInvoicePaidOutcome, type PaymentsFacadePort } from '../ports/payments-facade.port.js'

const MARK_PAID_AUDIT_CATEGORY = 'ledger_adjustment'
const MARK_PAID_ACTION = 'mark_invoice_paid'
const BILLING_INVOICE_ENTITY_TYPE = 'billing_invoice'

export interface MarkInvoicePaidCommand {
  readonly invoiceId: string
  readonly actor: { readonly userId: string }
  readonly requestId: string | null
}

@Injectable()
export class MarkInvoicePaidUseCase {
  public constructor(
    @Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
  ) {}

  public async execute(command: MarkInvoicePaidCommand): Promise<BillingInvoiceView> {
    const before = await this.paymentsFacade.getBillingInvoiceById(command.invoiceId)
    if (before === null) {
      throw new NotFoundError({ resource: 'billing_invoice', invoiceId: command.invoiceId })
    }
    return this.unitOfWork.run(async (tx) => {
      const outcome = await this.paymentsFacade.markInvoicePaid(command.invoiceId, tx)
      this.assertOutcome(outcome, command.invoiceId)
      const after = await this.paymentsFacade.getBillingInvoiceById(command.invoiceId)
      if (after === null) {
        throw new NotFoundError({ resource: 'billing_invoice', invoiceId: command.invoiceId })
      }
      await this.auditLog.write({
        category: MARK_PAID_AUDIT_CATEGORY,
        entityType: BILLING_INVOICE_ENTITY_TYPE,
        entityId: command.invoiceId,
        actorUserId: command.actor.userId,
        action: MARK_PAID_ACTION,
        metadata: { before: { status: before.status }, after: { status: after.status }, extra: { chainId: after.chainId } },
        requestId: command.requestId,
        tenantId: null,
      })
      return after
    })
  }

  private assertOutcome(outcome: MarkInvoicePaidOutcome, invoiceId: string): void {
    if (outcome === 'paid') return
    if (outcome === 'already_paid') {
      throw new ConflictError('Invoice already paid', { invoiceId })
    }
    if (outcome === 'not_found') {
      throw new NotFoundError({ resource: 'billing_invoice', invoiceId })
    }
    throw new BusinessRuleViolationError('Invoice is not in a payable status', { invoiceId })
  }
}
