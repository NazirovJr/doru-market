// Application-policy (не guard): chainId резолвится СЕРВЕРОМ из actor, клиентский chainId физически
// не принимается типом команды — отказ до обращения к порту.
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, type UserRole } from '@dorutj/contracts'
import {
  ONBOARDING_FACADE_PORT,
  type OnboardingFacadePort,
  type PharmacyAccountsAnyFilter,
  type PharmacyAccountsAnyPage,
  type PharmacyAccountsCursor,
} from '../ports/onboarding-facade.port.js'

export interface ListPharmacyAccountsOwnActor {
  readonly role: UserRole
  readonly chainId: string | null
}

export type PharmacyAccountsOwnFilter = Omit<PharmacyAccountsAnyFilter, 'chainId'>

export interface ListPharmacyAccountsOwnCommand {
  readonly actor: ListPharmacyAccountsOwnActor
  readonly filter: PharmacyAccountsOwnFilter
  readonly limit: number
  readonly cursor?: PharmacyAccountsCursor | null
}

@Injectable()
export class ListPharmacyAccountsOwnUseCase {
  public constructor(@Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort) {}

  public async execute(command: ListPharmacyAccountsOwnCommand): Promise<PharmacyAccountsAnyPage> {
    if (command.actor.role !== 'pharmacy_admin' || command.actor.chainId === null) {
      throw new CrossTenantAccessDeniedError({ role: command.actor.role })
    }
    const filter: PharmacyAccountsAnyFilter = { ...command.filter, chainId: command.actor.chainId }
    return this.onboardingFacade.findPharmacyAccountsAny(filter, { limit: command.limit, cursor: command.cursor ?? null })
  }
}
