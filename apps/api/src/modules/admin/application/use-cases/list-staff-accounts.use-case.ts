// DTJ-364: GET /staff-accounts?scope=own. chainId резолвится сервером из actor; роли фильтруются в SQL (filter.roles).
import { Inject, Injectable } from '@nestjs/common'
import { STAFF_ACCOUNT_ROLE_VALUES } from '@dorutj/contracts'
import {
  IDENTITY_FACADE_PORT,
  type IdentityFacadePort,
  type IdentityListCursor,
  type UserSummaryView,
} from '../ports/identity-facade.port.js'

export interface ListStaffAccountsCommand {
  readonly actor: { readonly role: string; readonly chainId: string | null }
  readonly limit: number
  readonly cursor?: IdentityListCursor | null
}

export interface StaffAccountListPage {
  readonly items: readonly UserSummaryView[]
  readonly nextCursor: IdentityListCursor | null
  readonly hasMore: boolean
}

@Injectable()
export class ListStaffAccountsUseCase {
  public constructor(@Inject(IDENTITY_FACADE_PORT) private readonly identityFacade: IdentityFacadePort) {}

  public async execute(command: ListStaffAccountsCommand): Promise<StaffAccountListPage> {
    const chainFilter = command.actor.role === 'pharmacy_admin' && command.actor.chainId !== null ? { chainId: command.actor.chainId } : {}
    return this.identityFacade.listUsers({
      filter: { roles: STAFF_ACCOUNT_ROLE_VALUES, ...chainFilter },
      limit: command.limit,
      cursor: command.cursor ?? null,
    })
  }
}
