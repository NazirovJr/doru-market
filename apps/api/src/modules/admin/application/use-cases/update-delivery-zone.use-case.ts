// Policy владения — тот же приём, что UpdatePharmacyScheduleUseCase/GetInventorySummaryUseCase.
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, UpdateDeliveryZoneBodySchema, ValidationError, type UpdateDeliveryZoneBodyDto, type UserRole } from '@dorutj/contracts'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort, type PharmacyDeliveryZoneView } from '../ports/onboarding-facade.port.js'

// ASSUMPTION: та же переиспользуемая категория, что UpdatePharmacyScheduleUseCase, не новая.
const AUDIT_CATEGORY = 'onboarding_decision'
const AUDIT_ENTITY_TYPE = 'pharmacy_account'
const AUDIT_ACTION = 'pharmacy_delivery_zone_update'

export interface UpdateDeliveryZoneActor {
  readonly userId: string
  readonly role: UserRole
  readonly chainId: string | null
  readonly tenantId: string | null
}

export interface UpdateDeliveryZoneCommand {
  readonly pharmacyId: string
  readonly rawBody: unknown
  readonly actor: UpdateDeliveryZoneActor
  readonly requestId: string | null
}

@Injectable()
export class UpdateDeliveryZoneUseCase {
  public constructor(
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
  ) {}

  public async execute(command: UpdateDeliveryZoneCommand): Promise<PharmacyDeliveryZoneView> {
    const body = parseBody(command.rawBody)
    if (command.actor.role !== 'super_admin') {
      await this.assertOwnsPharmacy(command.actor, command.pharmacyId)
    }
    const updated = await this.onboardingFacade.updateDeliveryZone(
      command.pharmacyId,
      { maxDeliveryRadiusKm: body.maxDeliveryRadiusKm },
      { id: command.actor.userId },
    )
    await this.auditLog.write({
      category: AUDIT_CATEGORY,
      entityType: AUDIT_ENTITY_TYPE,
      entityId: command.pharmacyId,
      actorUserId: command.actor.userId,
      action: AUDIT_ACTION,
      metadata: { after: { maxDeliveryRadiusKm: updated.maxDeliveryRadiusKm } },
      requestId: command.requestId,
      tenantId: command.actor.tenantId,
    })
    return updated
  }

  private async assertOwnsPharmacy(actor: UpdateDeliveryZoneActor, pharmacyId: string): Promise<void> {
    if (actor.chainId === null) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, pharmacyId })
    }
    const chainId = await this.onboardingFacade.getPharmacyChainId(pharmacyId)
    if (chainId !== actor.chainId) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, pharmacyId })
    }
  }
}

function parseBody(rawBody: unknown): UpdateDeliveryZoneBodyDto {
  const parsed = UpdateDeliveryZoneBodySchema.safeParse(rawBody)
  if (parsed.success) {
    return parsed.data
  }
  const firstIssue = parsed.error.issues[0]
  throw new ValidationError(firstIssue?.message ?? 'Invalid delivery zone patch', {
    field: firstIssue === undefined ? 'unknown' : firstIssue.path.join('.'),
    issues: parsed.error.issues,
  })
}
