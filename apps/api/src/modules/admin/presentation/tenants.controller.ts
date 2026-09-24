/**
 * `TenantsController` (EP-15, DTJ-351, SRS-ADM-027) — `GET /api/v1/tenants`,
 * `GET /api/v1/tenants/:id`, `PATCH /api/v1/tenant-settings/:tenantId`. `@Roles('super_admin')`
 * на уровне класса — ВСЕ три маршрута (1:1 приём `FeatureFlagsController`, DTJ-352, критерий
 * приёмки 4: `pharmacy_admin` → `403 INSUFFICIENT_ROLE` ДО входа в use case).
 *
 * Два разных префикса (`tenants`/`tenant-settings`) в ОДНОМ файле (`files_owned` тикета
 * называет ровно этот путь) — `@Controller({version:'1'})` БЕЗ `path` + полные относительные
 * пути на методах (`get-order-ledger.controller.ts` уже показывает: путь контроллера не
 * обязан совпадать с именем файла/папки).
 *
 * Ошибки — через `AllExceptionsFilter` (`ValidationError`/`NotFoundError` — `DomainError`,
 * не собственный `try/catch`, C12). `patch` тела `PATCH` НЕ проходит через `ZodValidationPipe`
 * здесь — валидация НАРОЧНО перенесена в `UpdateTenantSettingsUseCase` (см. её JSDoc,
 * ticket «Что сделать» п.3): тело приходит как `unknown`.
 */
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

/** 1:1 приём `feature-flags.controller.ts#parseListCursor` (DTJ-352). */
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
