// Policy владения — тот же приём, что UpdatePharmacyScheduleUseCase (нужен фронту для предзаполнения формы).
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, NotFoundError, type UserRole } from '@dorutj/contracts'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort, type PharmacyScheduleAndZoneView } from '../ports/onboarding-facade.port.js'

export interface GetPharmacyScheduleActor {
  readonly role: UserRole
  readonly chainId: string | null
}

export interface GetPharmacyScheduleCommand {
  readonly pharmacyId: string
  readonly actor: GetPharmacyScheduleActor
}

@Injectable()
export class GetPharmacyScheduleUseCase {
  public constructor(@Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort) {}

  public async execute(command: GetPharmacyScheduleCommand): Promise<PharmacyScheduleAndZoneView> {
    if (command.actor.role !== 'super_admin') {
      await this.assertOwnsPharmacy(command.actor, command.pharmacyId)
    }
    const view = await this.onboardingFacade.getScheduleAndZone(command.pharmacyId)
    if (view === null) {
      throw new NotFoundError({ pharmacyId: command.pharmacyId })
    }
    return view
  }

  private async assertOwnsPharmacy(actor: GetPharmacyScheduleActor, pharmacyId: string): Promise<void> {
    if (actor.chainId === null) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, pharmacyId })
    }
    const chainId = await this.onboardingFacade.getPharmacyChainId(pharmacyId)
    if (chainId !== actor.chainId) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, pharmacyId })
    }
  }
}
