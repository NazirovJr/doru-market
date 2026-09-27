// Тот же policy-приём, что CreatePharmacyApiKeyUseCase рядом (DTJ-365)/GetInventorySummaryUseCase (DTJ-362).
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError } from '@dorutj/contracts'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import {
  INVENTORY_FACADE_PORT,
  type InventoryFacadePort,
  type PharmacyApiKeySummaryView,
} from '../ports/inventory-facade.port.js'
import type { PharmacyApiKeyActor } from './create-pharmacy-api-key.use-case.js'

export interface ListPharmacyApiKeysCommand {
  readonly actor: PharmacyApiKeyActor
  readonly pharmacyId: string
}

@Injectable()
export class ListPharmacyApiKeysUseCase {
  public constructor(
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
  ) {}

  public async execute(command: ListPharmacyApiKeysCommand): Promise<readonly PharmacyApiKeySummaryView[]> {
    if (command.actor.role !== 'super_admin') {
      await this.assertOwnsPharmacy(command.actor, command.pharmacyId)
    }
    return this.inventoryFacade.listPharmacyApiKeys(command.pharmacyId)
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
