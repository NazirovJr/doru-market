// Смена статуса сети + audit_log — один unitOfWork.run (audit последним, откатывается вместе при ошибке).
// entityType='billing_invoice'/entityId=invoiceId (не chainId) — единообразно с MarkInvoicePaidUseCase, chainId в metadata.extra.
import { Inject, Injectable } from '@nestjs/common'
import { LiftInvoiceBlockBodySchema, NotFoundError, ValidationError } from '@dorutj/contracts'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/modules/auth/index.js'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import { PAYMENTS_FACADE_PORT, type PaymentsFacadePort } from '../ports/payments-facade.port.js'

const LIFT_BLOCK_AUDIT_CATEGORY = 'ledger_adjustment'
const LIFT_BLOCK_ACTION = 'lift_invoice_block'
const BILLING_INVOICE_ENTITY_TYPE = 'billing_invoice'

export interface LiftInvoiceBlockCommand {
  readonly invoiceId: string
  readonly rawBody: unknown
  readonly actor: { readonly userId: string }
  readonly requestId: string | null
}

@Injectable()
export class LiftInvoiceBlockUseCase {
  // eslint-disable-next-line max-params -- 4 порта (Payments/Onboarding/UnitOfWork/AuditLog) — тот же класс DI-инъекций, что AdminPaymentOverrideUseCase.
  public constructor(
    @Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort,
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
  ) {}

  public async execute(command: LiftInvoiceBlockCommand): Promise<void> {
    const body = parseBody(command.rawBody)
    const invoice = await this.paymentsFacade.getBillingInvoiceById(command.invoiceId)
    if (invoice === null) {
      throw new NotFoundError({ resource: 'billing_invoice', invoiceId: command.invoiceId })
    }
    return this.unitOfWork.run(async (tx) => {
      await this.onboardingFacade.liftInvoiceBlock(invoice.chainId, { id: command.actor.userId }, tx)
      await this.auditLog.write({
        category: LIFT_BLOCK_AUDIT_CATEGORY,
        entityType: BILLING_INVOICE_ENTITY_TYPE,
        entityId: command.invoiceId,
        actorUserId: command.actor.userId,
        action: LIFT_BLOCK_ACTION,
        reason: body.reason,
        metadata: { extra: { chainId: invoice.chainId } },
        requestId: command.requestId,
        tenantId: null,
      })
    })
  }
}

function parseBody(rawBody: unknown): { readonly reason: string } {
  const parsed = LiftInvoiceBlockBodySchema.safeParse(rawBody)
  if (parsed.success) {
    return parsed.data
  }
  const firstIssue = parsed.error.issues[0]
  throw new ValidationError(firstIssue?.message ?? 'Invalid lift-invoice-block request', {
    field: firstIssue === undefined ? 'reason' : firstIssue.path.join('.'),
    issues: parsed.error.issues,
  })
}
