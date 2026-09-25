import { Inject, Injectable } from '@nestjs/common'
import {
  IDENTITY_FACADE_PORT,
  type IdentityFacadePort,
  type IdentityListCursor,
  type IdentityListFilter,
  type IdentityListPage,
} from '../ports/identity-facade.port.js'

export interface ListUsersCommand {
  readonly filter: IdentityListFilter
  readonly limit: number
  readonly cursor?: IdentityListCursor | null
}

@Injectable()
export class ListUsersUseCase {
  public constructor(@Inject(IDENTITY_FACADE_PORT) private readonly identityFacade: IdentityFacadePort) {}

  public async execute(command: ListUsersCommand): Promise<IdentityListPage> {
    return this.identityFacade.listUsers({ filter: command.filter, limit: command.limit, cursor: command.cursor ?? null })
  }
}
