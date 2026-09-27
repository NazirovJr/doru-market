// facade.revokePharmacyApiKey уже фильтрует по pharmacyId в SQL — `false` покрывает и чужую аптеку, и "уже отозван".
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, NotFoundError } from '@dorutj/contracts'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import { INVENTORY_FACADE_PORT, type InventoryFacadePort } from '../ports/inventory-facade.port.js'
import type { PharmacyApiKeyActor } from './create-pharmacy-api-key.use-case.js'

export interface RevokePharmacyApiKeyCommand {
  readonly actor: PharmacyApiKeyActor
  readonly pharmacyId: string
  readonly keyId: string
  readonly reason: string
}

@Injectable()
export class RevokePharmacyApiKeyUseCase {
  public constructor(
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
  ) {}

  public async execute(command: RevokePharmacyApiKeyCommand): Promise<void> {
    if (command.actor.role !== 'super_admin') {
      await this.assertOwnsPharmacy(command.actor, command.pharmacyId)
    }
    const revoked = await this.inventoryFacade.revokePharmacyApiKey(command.pharmacyId, command.keyId, command.reason)
    if (!revoked) {
      throw new NotFoundError({ resource: 'pharmacy_api_key', keyId: command.keyId })
    }
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
