/**
 * `GetTenantUseCase` (EP-15, DTJ-351) — `GET /api/v1/tenants/:id` (`@Roles('super_admin')`).
 * `tenantId` не резолвится → `404 NOT_FOUND` (generic, `@dorutj/contracts`, тот же приём, что
 * `CompletePickingUseCase.loadAuthorizedOrder`) — маппинг доменных ошибок через
 * `AllExceptionsFilter`, не собственный `try/catch` в контроллере (C12).
 */
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { TENANCY_FACADE_PORT, type TenancyFacadePort, type TenantDetailView } from '../ports/tenancy-facade.port.js'

export interface GetTenantCommand {
  readonly tenantId: string
}

@Injectable()
export class GetTenantUseCase {
  public constructor(@Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort) {}

  public async execute(command: GetTenantCommand): Promise<TenantDetailView> {
    const tenant = await this.tenancyFacade.getTenantById(command.tenantId)
    if (tenant === null) {
      throw new NotFoundError({ resource: 'tenant', tenantId: command.tenantId })
    }
    return tenant
  }
}
