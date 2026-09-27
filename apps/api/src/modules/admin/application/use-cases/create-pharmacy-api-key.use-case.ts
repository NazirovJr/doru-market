// Тот же policy-приём, что GetInventorySummaryUseCase (DTJ-362).
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, type UserRole } from '@dorutj/contracts'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import {
  INVENTORY_FACADE_PORT,
  type CreatedPharmacyApiKeyView,
  type InventoryFacadePort,
} from '../ports/inventory-facade.port.js'

export const PHARMACY_API_KEY_AUDIT_CATEGORY = 'pharmacy_api_key'
const PHARMACY_API_KEY_ENTITY_TYPE = 'pharmacy_api_key'

export interface PharmacyApiKeyActor {
  readonly userId: string
  readonly role: UserRole
  readonly chainId: string | null
}

export interface CreatePharmacyApiKeyCommand {
  readonly actor: PharmacyApiKeyActor
  readonly pharmacyId: string
  readonly requestId: string | null
}

@Injectable()
export class CreatePharmacyApiKeyUseCase {
  public constructor(
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
  ) {}

  public async execute(command: CreatePharmacyApiKeyCommand): Promise<CreatedPharmacyApiKeyView> {
    if (command.actor.role !== 'super_admin') {
      await this.assertOwnsPharmacy(command.actor, command.pharmacyId)
    }
    const created = await this.inventoryFacade.createPharmacyApiKey(command.pharmacyId, command.actor.userId)
    await this.auditLog.write({
      category: PHARMACY_API_KEY_AUDIT_CATEGORY,
      entityType: PHARMACY_API_KEY_ENTITY_TYPE,
      entityId: created.id,
      actorUserId: command.actor.userId,
      action: 'create',
      metadata: { after: { pharmacyId: command.pharmacyId, keyPrefix: created.keyPrefix } },
      requestId: command.requestId,
      tenantId: null,
    })
    return created
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
