// UpsertCommissionRateUseCase (DTJ-358) — обслуживает POST (создание) и PATCH/:id (редактирование), тот же приём, что UpsertFeatureFlagUseCase.
// Zod-валидация — здесь, не в ZodValidationPipe контроллера (rawBody приходит непроверенным, схема из @dorutj/contracts переиспользуется формой apps/admin).
import { Inject, Injectable } from '@nestjs/common'
import { UpsertCommissionRateSchema, ValidationError, type UpsertCommissionRateDto } from '@dorutj/contracts'
import { PAYMENTS_FACADE_PORT, type CommissionRateView, type PaymentsFacadePort } from '../ports/payments-facade.port.js'

export interface UpsertCommissionRateCommand {
  readonly id?: string
  readonly rawBody: unknown
  readonly actor: { readonly userId: string }
}

@Injectable()
export class UpsertCommissionRateUseCase {
  public constructor(@Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort) {}

  public async execute(command: UpsertCommissionRateCommand): Promise<CommissionRateView> {
    const body = parseBody(command.rawBody)
    return this.paymentsFacade.upsertCommissionRate({
      id: command.id,
      tenantId: body.tenantId ?? null,
      chainId: body.chainId ?? null,
      category: body.category,
      rateBps: body.rateBps,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo ?? null,
      actorUserId: command.actor.userId,
    })
  }
}

function parseBody(rawBody: unknown): UpsertCommissionRateDto {
  const parsed = UpsertCommissionRateSchema.safeParse(rawBody)
  if (parsed.success) {
    return parsed.data
  }
  const firstIssue = parsed.error.issues[0]
  throw new ValidationError(firstIssue?.message ?? 'Invalid commission rate payload', {
    field: firstIssue === undefined ? 'unknown' : firstIssue.path.join('.'),
    issues: parsed.error.issues,
  })
}
