// Маршрут общий с DTJ-362 (scope=own, pharmacy_admin) — @Roles пускает обе роли, различие
// по query.scope внутри метода, иначе RolesGuard дал бы INSUFFICIENT_ROLE вместо CROSS_TENANT_ACCESS_DENIED.
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  ok,
  PharmacyAccountsListQuerySchema,
  type PaginationMeta,
  type PharmacyAccountAdminSummaryDto,
  type PharmacyAccountsListQueryDto,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import type {
  PharmacyAccountAdminSummaryView,
  PharmacyAccountsAnyFilter,
  PharmacyAccountsAnyPage,
  PharmacyAccountsCursor,
} from '../application/ports/onboarding-facade.port.js'
import { ListPharmacyAccountsAnyUseCase } from '../application/use-cases/list-pharmacy-accounts-any.use-case.js'
import { ListPharmacyAccountsOwnUseCase, type PharmacyAccountsOwnFilter } from '../application/use-cases/list-pharmacy-accounts-own.use-case.js'

@Controller({ version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class PharmacyAccountsOverviewController {
  public constructor(
    @Inject(ListPharmacyAccountsAnyUseCase) private readonly listPharmacyAccountsAnyUseCase: ListPharmacyAccountsAnyUseCase,
    @Inject(ListPharmacyAccountsOwnUseCase) private readonly listPharmacyAccountsOwnUseCase: ListPharmacyAccountsOwnUseCase,
  ) {}

  @Get('pharmacy-accounts')
  @Roles('super_admin', 'pharmacy_admin')
  public async list(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(PharmacyAccountsListQuerySchema)) query: PharmacyAccountsListQueryDto,
  ): Promise<SuccessEnvelope<readonly PharmacyAccountAdminSummaryDto[]>> {
    const cursor = parseListCursor(query.cursor)
    const result: PharmacyAccountsAnyPage =
      query.scope === 'own'
        ? await this.listPharmacyAccountsOwnUseCase.execute({
            actor: { role: claims.role, chainId: claims.chainId },
            filter: toOwnFilter(query),
            limit: query.limit,
            cursor,
          })
        : await this.listPharmacyAccountsAnyUseCase.execute({
            actor: { role: claims.role },
            filter: toFilter(query),
            limit: query.limit,
            cursor,
          })
    const meta: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }
    return ok(result.items.map(toSummaryDto), { pagination: meta })
  }
}

function toFilter(query: PharmacyAccountsListQueryDto): PharmacyAccountsAnyFilter {
  return {
    ...(query['filter[status]'] !== undefined && { status: query['filter[status]'] }),
    ...(query['filter[chainId]'] !== undefined && { chainId: query['filter[chainId]'] }),
    ...(query['filter[name][like]'] !== undefined && { nameLike: query['filter[name][like]'] }),
  }
}

// Даже не читает query['filter[chainId]'] — тип PharmacyAccountsOwnFilter его не несёт.
function toOwnFilter(query: PharmacyAccountsListQueryDto): PharmacyAccountsOwnFilter {
  return {
    ...(query['filter[status]'] !== undefined && { status: query['filter[status]'] }),
    ...(query['filter[name][like]'] !== undefined && { nameLike: query['filter[name][like]'] }),
  }
}

function parseListCursor(raw: string | undefined): PharmacyAccountsCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}

function toSummaryDto(view: PharmacyAccountAdminSummaryView): PharmacyAccountAdminSummaryDto {
  return {
    id: view.id,
    chainId: view.chainId,
    chainName: view.chainName,
    name: view.name,
    status: view.status,
    licenseExpiryDate: view.licenseExpiryDate === null ? null : view.licenseExpiryDate.toISOString().slice(0, 10),
  }
}
