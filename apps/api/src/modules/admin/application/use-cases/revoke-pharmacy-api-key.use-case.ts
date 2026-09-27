// facade.revokePharmacyApiKey уже фильтрует по pharmacyId в SQL — `false` покрывает и чужую аптеку, и "уже отозван".
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, NotFoundError } from '@dorutj/contracts'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import { INVENTORY_FACADE_PORT, type InventoryFacadePort } from '../ports/inventory-facade.port.js'
import { PHARMACY_API_KEY_AUDIT_CATEGORY, type PharmacyApiKeyActor } from './create-pharmacy-api-key.use-case.js'

const PHARMACY_API_KEY_ENTITY_TYPE = 'pharmacy_api_key'

export interface RevokePharmacyApiKeyCommand {
  readonly actor: PharmacyApiKeyActor
  readonly pharmacyId: string
  readonly keyId: string
  readonly reason: string
  readonly requestId: string | null
}

@Injectable()
export class RevokePharmacyApiKeyUseCase {
  public constructor(
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
  ) {}

  public async execute(command: RevokePharmacyApiKeyCommand): Promise<void> {
    if (command.actor.role !== 'super_admin') {
      await this.assertOwnsPharmacy(command.actor, command.pharmacyId)
    }
    const revoked = await this.inventoryFacade.revokePharmacyApiKey(command.pharmacyId, command.keyId, command.reason)
    if (!revoked) {
      throw new NotFoundError({ resource: 'pharmacy_api_key', keyId: command.keyId })
    }
    await this.auditLog.write({
      category: PHARMACY_API_KEY_AUDIT_CATEGORY,
      entityType: PHARMACY_API_KEY_ENTITY_TYPE,
      entityId: command.keyId,
      actorUserId: command.actor.userId,
      action: 'revoke',
      reason: command.reason,
      metadata: { before: { isActive: true }, after: { isActive: false } },
      requestId: command.requestId,
      tenantId: null,
    })
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
