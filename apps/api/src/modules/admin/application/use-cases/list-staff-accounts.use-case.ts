// DTJ-364: GET /staff-accounts?scope=own. chainId резолвится сервером из actor, не из query.
import { Inject, Injectable } from '@nestjs/common'
import type { StaffAccountRole } from '@dorutj/contracts'
import {
  IDENTITY_FACADE_PORT,
  type IdentityFacadePort,
  type IdentityListCursor,
  type UserSummaryView,
} from '../ports/identity-facade.port.js'

const STAFF_ACCOUNT_ROLES: readonly StaffAccountRole[] = ['pharmacist', 'courier']

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
    const page = await this.identityFacade.listUsers({
      filter: command.actor.role === 'pharmacy_admin' && command.actor.chainId !== null ? { chainId: command.actor.chainId } : {},
      limit: command.limit,
      cursor: command.cursor ?? null,
    })
    return {
      items: page.items.filter((user) => isStaffAccountRole(user.role)),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    }
  }
}

function isStaffAccountRole(role: string): role is StaffAccountRole {
  return (STAFF_ACCOUNT_ROLES as readonly string[]).includes(role)
}
