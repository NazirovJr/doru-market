// Грейс-период — из AppConfigService (API_KEY_ROTATION_GRACE_PERIOD_HOURS), не хардкод (C6).
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, NotFoundError } from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import {
  INVENTORY_FACADE_PORT,
  type CreatedPharmacyApiKeyView,
  type InventoryFacadePort,
} from '../ports/inventory-facade.port.js'
import { PHARMACY_API_KEY_AUDIT_CATEGORY, type PharmacyApiKeyActor } from './create-pharmacy-api-key.use-case.js'

const PHARMACY_API_KEY_ENTITY_TYPE = 'pharmacy_api_key'

export interface RotatePharmacyApiKeyCommand {
  readonly actor: PharmacyApiKeyActor
  readonly pharmacyId: string
  readonly oldKeyId: string
  readonly requestId: string | null
}

@Injectable()
export class RotatePharmacyApiKeyUseCase {
  // eslint-disable-next-line max-params -- NestJS DI: 4 конструктор-инъекции, та же практика, что telegram-auth.use-case.ts
  public constructor(
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  public async execute(command: RotatePharmacyApiKeyCommand): Promise<CreatedPharmacyApiKeyView> {
    if (command.actor.role !== 'super_admin') {
      await this.assertOwnsPharmacy(command.actor, command.pharmacyId)
    }
    const rotated = await this.inventoryFacade.rotatePharmacyApiKey({
      pharmacyId: command.pharmacyId,
      oldKeyId: command.oldKeyId,
      gracePeriodHours: this.config.apiKeyRotationGracePeriodHours,
      createdByAdminId: command.actor.userId,
    })
    if (rotated === null) {
      throw new NotFoundError({ resource: 'pharmacy_api_key', keyId: command.oldKeyId })
    }
    await this.auditLog.write({
      category: PHARMACY_API_KEY_AUDIT_CATEGORY,
      entityType: PHARMACY_API_KEY_ENTITY_TYPE,
      entityId: rotated.id,
      actorUserId: command.actor.userId,
      action: 'rotate',
      metadata: { before: { keyId: command.oldKeyId }, after: { pharmacyId: command.pharmacyId, keyPrefix: rotated.keyPrefix } },
      requestId: command.requestId,
      tenantId: null,
    })
    return rotated
  }

  private async assertOwnsPharmacy(actor: PharmacyApiKeyActor, pharmacyId: string): Promise<void> {
    if (actor.chainId === null) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, pharmacyId })
    }
    const chainId = await this.onboardingFacade.getPharmacyChainId(pharmacyId)
    if (chainId !== actor.chainId) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, pharmacyId })
    }
  }
}
