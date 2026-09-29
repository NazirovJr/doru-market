import { Inject, Injectable } from '@nestjs/common'
import { NEUTRAL_FALLBACK_PALETTE, NotFoundError, type TenantBrandingDto } from '@dorutj/contracts'
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../ports/tenant-repository.port.js'
import { TenantId } from '../../domain/value-objects/tenant-id.vo.js'

export interface GetBrandingCommand {
  readonly tenantId: string
}

@Injectable()
export class GetBrandingUseCase {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort) {}

  async execute(command: GetBrandingCommand): Promise<TenantBrandingDto> {
    const tenant = await this.tenants.findById(TenantId.from(command.tenantId))
    if (tenant === null) {
      throw new NotFoundError({ resource: 'tenant', tenantId: command.tenantId })
    }
    const { settings } = tenant
    const isEmpty = Object.keys(settings.brandPalette).length === 0
    return {
      slug: tenant.slug.value,
      brandName: settings.brandName,
      palette: isEmpty ? NEUTRAL_FALLBACK_PALETTE : settings.brandPalette,
      logoUrl: settings.brandLogoUrl,
      // В tenant_settings нет колонок favicon/support_phone — поля контракта зарезервированы, значение null.
      faviconUrl: null,
      supportPhone: null,
    }
  }
}
