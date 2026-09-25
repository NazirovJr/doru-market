// Application-policy (не guard): для не-super_admin проверяет владение ДО обращения к inventory —
// чужая аптека не должна триггерить агрегирующий запрос остатков вовсе.
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, type UserRole } from '@dorutj/contracts'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import { INVENTORY_FACADE_PORT, type InventoryFacadePort, type InventorySummaryView } from '../ports/inventory-facade.port.js'

export interface GetInventorySummaryActor {
  readonly role: UserRole
  readonly chainId: string | null
}

export interface GetInventorySummaryCommand {
  readonly actor: GetInventorySummaryActor
  readonly pharmacyId: string
}

@Injectable()
export class GetInventorySummaryUseCase {
  public constructor(
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
  ) {}

  public async execute(command: GetInventorySummaryCommand): Promise<InventorySummaryView> {
    if (command.actor.role !== 'super_admin') {
      await this.assertOwnsPharmacy(command.actor, command.pharmacyId)
    }
    return this.inventoryFacade.getInventorySummary(command.pharmacyId)
  }

  private async assertOwnsPharmacy(actor: GetInventorySummaryActor, pharmacyId: string): Promise<void> {
    if (actor.chainId === null) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, pharmacyId })
    }
    const chainId = await this.onboardingFacade.getPharmacyChainId(pharmacyId)
    if (chainId !== actor.chainId) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, pharmacyId })
    }
  }
}
