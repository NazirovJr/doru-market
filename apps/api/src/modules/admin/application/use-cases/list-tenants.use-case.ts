import { Inject, Injectable } from '@nestjs/common'
import {
  TENANCY_FACADE_PORT,
  type TenancyFacadePort,
  type TenancyListCursor,
  type TenantSummaryView,
} from '../ports/tenancy-facade.port.js'

export interface ListTenantsCommand {
  readonly limit: number
  readonly cursor?: TenancyListCursor | null
}

export interface ListTenantsResult {
  readonly items: readonly TenantSummaryView[]
  readonly nextCursor: TenancyListCursor | null
  readonly hasMore: boolean
}

@Injectable()
export class ListTenantsUseCase {
  public constructor(@Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort) {}

  public async execute(command: ListTenantsCommand): Promise<ListTenantsResult> {
    return this.tenancyFacade.listTenants({ limit: command.limit, cursor: command.cursor ?? null })
  }
}
