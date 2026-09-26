// DTJ-364: НЕ регистрирует POST /staff-accounts (создание) — остаётся за auth-контроллером (DTJ-030).
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import {
  decodeCursor,
  DeactivateStaffAccountBodySchema,
  encodeCursor,
  InvalidCursorError,
  ListStaffAccountsQuerySchema,
  ok,
  type ListStaffAccountsQueryDto,
  type PaginationMeta,
  type StaffAccountSummaryDto,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import type { IdentityListCursor, UserSummaryView } from '../application/ports/identity-facade.port.js'
import type { CourierSummaryView } from '../application/ports/delivery-facade.port.js'
import { ListStaffAccountsUseCase } from '../application/use-cases/list-staff-accounts.use-case.js'
import { DeactivateStaffAccountUseCase } from '../application/use-cases/deactivate-staff-account.use-case.js'
import { ProvisionCourierForChainUseCase } from '../application/use-cases/provision-courier-for-chain.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'staff-accounts', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('pharmacy_admin', 'super_admin')
export class StaffAccountsController {
  public constructor(
    @Inject(ListStaffAccountsUseCase) private readonly listUseCase: ListStaffAccountsUseCase,
    @Inject(DeactivateStaffAccountUseCase) private readonly deactivateUseCase: DeactivateStaffAccountUseCase,
    @Inject(ProvisionCourierForChainUseCase) private readonly provisionCourierUseCase: ProvisionCourierForChainUseCase,
  ) {}

  @Get()
  public async list(
    @Query(new ZodValidationPipe(ListStaffAccountsQuerySchema)) query: ListStaffAccountsQueryDto,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<readonly StaffAccountSummaryDto[]>> {
    const page = await this.listUseCase.execute({
      actor: { role: claims.role, chainId: claims.chainId },
      limit: query.limit,
      cursor: parseListCursor(query.cursor),
    })
    const meta: PaginationMeta = {
      nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      hasMore: page.hasMore,
      limit: query.limit,
    }
    return ok(page.items.map(toStaffAccountDto), { pagination: meta })
  }

  @Patch(':id')
  public async deactivate(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(DeactivateStaffAccountBodySchema)) _body: unknown,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<StaffAccountSummaryDto>> {
    const view = await this.deactivateUseCase.execute({
      userId: id,
      actor: { userId: claims.sub, role: claims.role, chainId: claims.chainId },
    })
    return ok(toStaffAccountDto(view))
  }

  @Post(':id/provision-courier')
  @HttpCode(HttpStatus.Ok)
  public async provisionCourier(
    @Param('id', ID_PARSE_UUID) id: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<CourierSummaryView>> {
    const courier = await this.provisionCourierUseCase.execute({
      userId: id,
      actor: { role: claims.role, chainId: claims.chainId },
    })
    return ok(courier)
  }
}

function parseListCursor(raw: string | undefined): IdentityListCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}

function toStaffAccountDto(view: UserSummaryView): StaffAccountSummaryDto {
  return {
    id: view.id,
    phoneNumber: view.phoneNumber,
    fullName: view.fullName,
    role: view.role as 'pharmacist' | 'courier', // ListStaffAccountsUseCase уже отфильтровал роль
    pharmacyId: view.pharmacyId ?? null,
    chainId: view.chainId ?? null,
    isActive: view.isActive,
    createdAt: view.createdAt.toISOString(),
    courierProvisioned: null, // per-row вызов был бы N+1 — не проверяется в списке (см. отчёт)
  }
}
