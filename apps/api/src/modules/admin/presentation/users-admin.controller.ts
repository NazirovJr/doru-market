// grant-platform-role — отдельный эндпоинт, не переиспользует Patch .../role.
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import {
  decodeCursor,
  DeactivateUserBodySchema,
  encodeCursor,
  InvalidCursorError,
  ok,
  UsersListQuerySchema,
  type PaginationMeta,
  type SuccessEnvelope,
  type UserSummaryDto,
  type UsersListQueryDto,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { RequestContext } from '@/common/context/request-context.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import type { IdentityListCursor, IdentityListFilter, UserSummaryView } from '../application/ports/identity-facade.port.js'
import { ListUsersUseCase } from '../application/use-cases/list-users.use-case.js'
import { DeactivateUserUseCase } from '../application/use-cases/deactivate-user.use-case.js'
import { ChangeStaffRoleUseCase } from '../application/use-cases/change-staff-role.use-case.js'
import { GrantPlatformRoleUseCase } from '../application/use-cases/grant-platform-role.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class UsersAdminController {
  // eslint-disable-next-line max-params -- 4 use case'а модуля, 1:1 с четырьмя эндпоинтами контроллера (тот же приём, что OrderReturnsController).
  public constructor(
    @Inject(ListUsersUseCase) private readonly listUsersUseCase: ListUsersUseCase,
    @Inject(DeactivateUserUseCase) private readonly deactivateUserUseCase: DeactivateUserUseCase,
    @Inject(ChangeStaffRoleUseCase) private readonly changeStaffRoleUseCase: ChangeStaffRoleUseCase,
    @Inject(GrantPlatformRoleUseCase) private readonly grantPlatformRoleUseCase: GrantPlatformRoleUseCase,
  ) {}

  @Get('users')
  public async list(
    @Query(new ZodValidationPipe(UsersListQuerySchema)) query: UsersListQueryDto,
  ): Promise<SuccessEnvelope<readonly UserSummaryDto[]>> {
    const result = await this.listUsersUseCase.execute({
      filter: toFilter(query),
      limit: query.limit,
      cursor: parseListCursor(query.cursor),
    })
    const meta: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }
    return ok(result.items.map(toUserDto), { pagination: meta })
  }

  @Patch('users/:id')
  public async deactivate(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(DeactivateUserBodySchema)) _body: unknown,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<UserSummaryDto>> {
    const view = await this.deactivateUserUseCase.execute({ userId: id, actor: { userId: claims.sub } })
    return ok(toUserDto(view))
  }

  @Patch('users/:id/role')
  public async changeRole(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() rawBody: unknown,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<UserSummaryDto>> {
    const view = await this.changeStaffRoleUseCase.execute({ userId: id, rawBody, actor: { userId: claims.sub } })
    return ok(toUserDto(view))
  }

  @Post('users/:id/grant-platform-role')
  @HttpCode(HttpStatus.Ok)
  public async grantPlatformRole(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() rawBody: unknown,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<UserSummaryDto>> {
    const view = await this.grantPlatformRoleUseCase.execute({
      userId: id,
      rawBody,
      actor: { userId: claims.sub },
      requestId: RequestContext.get()?.requestId ?? null,
    })
    return ok(toUserDto(view))
  }
}

function toFilter(query: UsersListQueryDto): IdentityListFilter {
  return {
    ...(query.role !== undefined && { role: query.role }),
    ...(query.phoneNumber !== undefined && { phoneLike: query.phoneNumber }),
    ...(query.tenantId !== undefined && { tenantId: query.tenantId }),
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

function toUserDto(view: UserSummaryView): UserSummaryDto {
  return {
    id: view.id,
    tenantId: view.tenantId,
    phoneNumber: view.phoneNumber,
    role: view.role,
    fullName: view.fullName,
    isActive: view.isActive,
    createdAt: view.createdAt.toISOString(),
  }
}
