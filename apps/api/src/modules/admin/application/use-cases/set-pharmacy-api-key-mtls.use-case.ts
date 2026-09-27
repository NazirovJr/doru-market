import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, NotFoundError } from '@dorutj/contracts'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import {
  INVENTORY_FACADE_PORT,
  type InventoryFacadePort,
  type PharmacyApiKeySummaryView,
} from '../ports/inventory-facade.port.js'
import type { PharmacyApiKeyActor } from './create-pharmacy-api-key.use-case.js'

export interface SetPharmacyApiKeyMtlsCommand {
  readonly actor: PharmacyApiKeyActor
  readonly pharmacyId: string
  readonly keyId: string
  readonly requireMtls: boolean
}

@Injectable()
export class SetPharmacyApiKeyMtlsUseCase {
  public constructor(
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
  ) {}

  public async execute(command: SetPharmacyApiKeyMtlsCommand): Promise<PharmacyApiKeySummaryView> {
    if (command.actor.role !== 'super_admin') {
      await this.assertOwnsPharmacy(command.actor, command.pharmacyId)
    }
    const updated = await this.inventoryFacade.setPharmacyApiKeyMtls(command.pharmacyId, command.keyId, command.requireMtls)
    if (updated === null) {
      throw new NotFoundError({ resource: 'pharmacy_api_key', keyId: command.keyId })
    }
    return updated
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
