/**
 * `TenancyFacadeAdapter` (EP-15, DTJ-351) — реализация `TenancyFacadePort` напрямую поверх
 * `TENANT_REPOSITORY` (`modules/tenancy/index.ts`) — см. JSDoc порта про отсутствие
 * собственного класса-фасада у `tenancy`.
 *
 * `updateTenantSettings` — load-modify-save: `TenantRepositoryPort.findById` → `Tenant.
 * applySettingsPatch()` (домен, ДОБАВЛЕНО этим тикетом) → `save()`. `codLimitDiram` конвертируется
 * `number ↔ bigint` РОВНО на этой границе (см. JSDoc контракта `packages/contracts/src/admin/
 * tenants.ts`) — по обе стороны от неё (Zod-схема, домен `TenantSettings`) типы уже свои.
 */
import { Inject, Injectable } from '@nestjs/common'
import { TENANT_REPOSITORY, TenantId, type Tenant, type TenantRepositoryPort } from '@/modules/tenancy/index.js'
import {
  TENANCY_FACADE_PORT,
  type TenancyFacadeActor,
  type TenancyFacadePort,
  type TenancyListPage,
  type TenancyListQuery,
  type TenantDetailView,
  type TenantSettingsPatch,
  type TenantSummaryView,
} from '@/modules/admin/application/ports/tenancy-facade.port.js'

@Injectable()
export class TenancyFacadeAdapter implements TenancyFacadePort {
  public constructor(@Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepositoryPort) {}

  public async listTenants(query: TenancyListQuery): Promise<TenancyListPage> {
    const page = await this.tenantRepository.list({ limit: query.limit, cursor: query.cursor ?? null })
    return {
      items: page.items.map((item) => toSummaryView(item.tenant, item.createdAt)),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    }
  }

  public async getTenantById(id: string): Promise<TenantDetailView | null> {
    const tenant = await this.tenantRepository.findById(TenantId.from(id))
    return tenant === null ? null : toDetailView(tenant)
  }

  public async updateTenantSettings(
    tenantId: string,
    patch: TenantSettingsPatch,
    _actor: TenancyFacadeActor,
  ): Promise<TenantDetailView | null> {
    const id = TenantId.from(tenantId)
    const tenant = await this.tenantRepository.findById(id)
    if (tenant === null) {
      return null
    }
    const updated = tenant.applySettingsPatch({
      ...(patch.brandName !== undefined && { brandName: patch.brandName }),
      ...(patch.brandPalette !== undefined && { brandPalette: patch.brandPalette }),
      ...(patch.brandLogoUrl !== undefined && { brandLogoUrl: patch.brandLogoUrl }),
      ...(patch.codLimitDiram !== undefined && { codLimitDiram: BigInt(patch.codLimitDiram) }),
      ...(patch.holdPeriodDays !== undefined && { holdPeriodDays: patch.holdPeriodDays }),
    })
    await this.tenantRepository.save(updated)
    return toDetailView(updated)
  }
}

function toSummaryView(tenant: Tenant, createdAt: Date): TenantSummaryView {
  return {
    id: tenant.id.value,
    slug: tenant.slug.value,
    isNeutral: tenant.isNeutral,
    customDomain: tenant.customDomain,
    brandName: tenant.settings.brandName,
    createdAt,
  }
}

function toDetailView(tenant: Tenant): TenantDetailView {
  return {
    id: tenant.id.value,
    slug: tenant.slug.value,
    isNeutral: tenant.isNeutral,
    customDomain: tenant.customDomain,
    brandName: tenant.settings.brandName,
    brandLogoUrl: tenant.settings.brandLogoUrl,
    brandPalette: tenant.settings.brandPalette,
    codLimitDiram: Number(tenant.settings.codLimitDiram),
    holdPeriodDays: tenant.settings.holdPeriodDays,
  }
}

export const TENANCY_FACADE_PORT_PROVIDER = {
  provide: TENANCY_FACADE_PORT,
  useClass: TenancyFacadeAdapter,
} as const
