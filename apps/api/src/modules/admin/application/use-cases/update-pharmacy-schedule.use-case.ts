// Policy владения — тот же приём, что GetInventorySummaryUseCase (chainId из JWT, не из тела запроса).
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, UpdatePharmacyScheduleBodySchema, ValidationError, type UpdatePharmacyScheduleBodyDto, type UserRole } from '@dorutj/contracts'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort, type PharmacyScheduleView } from '../ports/onboarding-facade.port.js'

// migrations/0060 — отдельная категория (onboarding_decision не подходит для рутинного апдейта полей).
const AUDIT_CATEGORY = 'pharmacy_settings_change'
const AUDIT_ENTITY_TYPE = 'pharmacy_account'
const AUDIT_ACTION = 'pharmacy_schedule_update'

export interface UpdatePharmacyScheduleActor {
  readonly userId: string
  readonly role: UserRole
  readonly chainId: string | null
  readonly tenantId: string | null
}

export interface UpdatePharmacyScheduleCommand {
  readonly pharmacyId: string
  readonly rawBody: unknown
  readonly actor: UpdatePharmacyScheduleActor
  readonly requestId: string | null
}

@Injectable()
export class UpdatePharmacyScheduleUseCase {
  public constructor(
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
  ) {}

  public async execute(command: UpdatePharmacyScheduleCommand): Promise<PharmacyScheduleView> {
    const body = parseBody(command.rawBody)
    if (command.actor.role !== 'super_admin') {
      await this.assertOwnsPharmacy(command.actor, command.pharmacyId)
    }
    const updated = await this.onboardingFacade.updateSchedule(
      command.pharmacyId,
      { isOpen247: body.isOpen247, openingTime: body.openingTime ?? null, closingTime: body.closingTime ?? null },
      { id: command.actor.userId },
    )
    await this.auditLog.write({
      category: AUDIT_CATEGORY,
      entityType: AUDIT_ENTITY_TYPE,
      entityId: command.pharmacyId,
      actorUserId: command.actor.userId,
      action: AUDIT_ACTION,
      metadata: { after: { isOpen247: updated.isOpen247, openingTime: updated.openingTime, closingTime: updated.closingTime } },
      requestId: command.requestId,
      tenantId: command.actor.tenantId,
    })
    return updated
  }

  private async assertOwnsPharmacy(actor: UpdatePharmacyScheduleActor, pharmacyId: string): Promise<void> {
    if (actor.chainId === null) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, pharmacyId })
    }
    const chainId = await this.onboardingFacade.getPharmacyChainId(pharmacyId)
    if (chainId !== actor.chainId) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, pharmacyId })
    }
  }
}

function parseBody(rawBody: unknown): UpdatePharmacyScheduleBodyDto {
  const parsed = UpdatePharmacyScheduleBodySchema.safeParse(rawBody)
  if (parsed.success) {
    return parsed.data
  }
  const firstIssue = parsed.error.issues[0]
  throw new ValidationError(firstIssue?.message ?? 'Invalid pharmacy schedule patch', {
    field: firstIssue === undefined ? 'unknown' : firstIssue.path.join('.'),
    issues: parsed.error.issues,
  })
}
