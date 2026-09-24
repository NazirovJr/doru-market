// Два префикса (tenants/tenant-settings) в одном контроллере — @Controller без path, полный путь на методах.
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common'
import {
  cursorQuerySchema,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  ok,
  type CursorQuery,
  type PaginationMeta,
  type SuccessEnvelope,
  type TenantDetailDto,
  type TenantSummaryDto,
} from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import type { TenancyListCursor, TenantDetailView, TenantSummaryView } from '../application/ports/tenancy-facade.port.js'
import { ListTenantsUseCase } from '../application/use-cases/list-tenants.use-case.js'
import { GetTenantUseCase } from '../application/use-cases/get-tenant.use-case.js'
import { UpdateTenantSettingsUseCase } from '../application/use-cases/update-tenant-settings.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class TenantsController {
  public constructor(
    @Inject(ListTenantsUseCase) private readonly listTenantsUseCase: ListTenantsUseCase,
    @Inject(GetTenantUseCase) private readonly getTenantUseCase: GetTenantUseCase,
    @Inject(UpdateTenantSettingsUseCase) private readonly updateTenantSettingsUseCase: UpdateTenantSettingsUseCase,
  ) {}

  @Get('tenants')
  public async list(
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ): Promise<SuccessEnvelope<readonly TenantSummaryDto[]>> {
    const result = await this.listTenantsUseCase.execute({ limit: query.limit, cursor: parseListCursor(query.cursor) })
    const meta: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }
    return ok(result.items.map(toSummaryDto), { pagination: meta })
  }

  @Get('tenants/:id')
  public async getById(@Param('id', ID_PARSE_UUID) id: string): Promise<SuccessEnvelope<TenantDetailDto>> {
    const view = await this.getTenantUseCase.execute({ tenantId: id })
    return ok(toDetailDto(view))
  }

  @Patch('tenant-settings/:tenantId')
  public async updateSettings(
    @Param('tenantId', ID_PARSE_UUID) tenantId: string,
    @Body() rawPatch: unknown,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<TenantDetailDto>> {
    const view = await this.updateTenantSettingsUseCase.execute({ tenantId, rawPatch, actor: { userId: claims.sub } })
    return ok(toDetailDto(view))
  }
}

function parseListCursor(raw: string | undefined): TenancyListCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}

function toSummaryDto(view: TenantSummaryView): TenantSummaryDto {
  return {
    id: view.id,
    slug: view.slug,
    isNeutral: view.isNeutral,
    customDomain: view.customDomain,
    brandName: view.brandName,
    createdAt: view.createdAt.toISOString(),
  }
}

function toDetailDto(view: TenantDetailView): TenantDetailDto {
  return {
    id: view.id,
    slug: view.slug,
    isNeutral: view.isNeutral,
    customDomain: view.customDomain,
    brandName: view.brandName,
    brandLogoUrl: view.brandLogoUrl,
    brandPalette: view.brandPalette,
    codLimitDiram: view.codLimitDiram,
    holdPeriodDays: view.holdPeriodDays,
  }
}
