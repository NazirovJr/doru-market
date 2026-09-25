// Application-policy (не guard) — не-super_admin отказывается ДО обращения к порту.
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, type UserRole } from '@dorutj/contracts'
import {
  ONBOARDING_FACADE_PORT,
  type OnboardingFacadePort,
  type PharmacyAccountsAnyFilter,
  type PharmacyAccountsAnyPage,
  type PharmacyAccountsCursor,
} from '../ports/onboarding-facade.port.js'

export interface ListPharmacyAccountsAnyActor {
  readonly role: UserRole
}

export interface ListPharmacyAccountsAnyCommand {
  readonly actor: ListPharmacyAccountsAnyActor
  readonly filter: PharmacyAccountsAnyFilter
  readonly limit: number
  readonly cursor?: PharmacyAccountsCursor | null
}

@Injectable()
export class ListPharmacyAccountsAnyUseCase {
  public constructor(@Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort) {}

  public async execute(command: ListPharmacyAccountsAnyCommand): Promise<PharmacyAccountsAnyPage> {
    if (command.actor.role !== 'super_admin') {
      throw new CrossTenantAccessDeniedError({ role: command.actor.role })
    }
    return this.onboardingFacade.findPharmacyAccountsAny(command.filter, { limit: command.limit, cursor: command.cursor ?? null })
  }
}
