// Тот же policy-приём, что GetInventorySummaryUseCase (DTJ-362): pharmacy_admin владеет ключами
// ТОЛЬКО аптек своей сети (chainId из JWT), super_admin — любой аптекой.
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, type UserRole } from '@dorutj/contracts'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import {
  INVENTORY_FACADE_PORT,
  type CreatedPharmacyApiKeyView,
  type InventoryFacadePort,
} from '../ports/inventory-facade.port.js'

export interface PharmacyApiKeyActor {
  readonly role: UserRole
  readonly chainId: string | null
}

export interface CreatePharmacyApiKeyCommand {
  readonly actor: PharmacyApiKeyActor
  readonly pharmacyId: string
}

@Injectable()
export class CreatePharmacyApiKeyUseCase {
  public constructor(
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
  ) {}

  public async execute(command: CreatePharmacyApiKeyCommand): Promise<CreatedPharmacyApiKeyView> {
    if (command.actor.role !== 'super_admin') {
      await this.assertOwnsPharmacy(command.actor, command.pharmacyId)
    }
    return this.inventoryFacade.createPharmacyApiKey(command.pharmacyId)
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
