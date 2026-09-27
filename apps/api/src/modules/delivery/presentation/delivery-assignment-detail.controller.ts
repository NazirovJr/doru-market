// mine (курьер, REST catch-up после WS-реконнекта) и деталь по id (скоуп — внутри use case).
import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common'
import { encodeCursor, ok, ValidationError, type PaginationMeta, type SuccessEnvelope } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import {
  GetMineDeliveryAssignmentsUseCase,
  type MineAssignmentsScope,
} from '../application/use-cases/get-mine-delivery-assignments.use-case.js'
import { GetDeliveryAssignmentDetailUseCase } from '../application/use-cases/get-delivery-assignment-detail.use-case.js'
import { parseDeliveryListQuery, type DeliveryListQueryParams } from './delivery-list-query.util.js'
import {
  toDeliveryAssignmentDetailDto,
  toMineAssignmentDto,
  type DeliveryAssignmentDetailDto,
  type MineAssignmentDto,
} from './delivery-assignment-detail.dto.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })
const MINE_SCOPE_VALUES = ['active', 'history'] as const

interface MineQueryParams extends DeliveryListQueryParams {
  readonly status?: string
}

@Controller({ path: 'delivery-assignments', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class DeliveryAssignmentDetailController {
  public constructor(
    @Inject(GetMineDeliveryAssignmentsUseCase) private readonly getMine: GetMineDeliveryAssignmentsUseCase,
    @Inject(GetDeliveryAssignmentDetailUseCase) private readonly getDetail: GetDeliveryAssignmentDetailUseCase,
  ) {}

  @Get('mine')
  @HttpCode(HttpStatus.Ok)
  @Roles('courier')
  public async mine(
    @CurrentUser() claims: JwtClaims,
    @Query() query: MineQueryParams,
  ): Promise<SuccessEnvelope<readonly MineAssignmentDto[]>> {
    const scope = parseScope(query.status)
    const { limit, cursor: rawCursor } = parseDeliveryListQuery(query)
    const cursor = rawCursor === null ? null : { createdAt: new Date(rawCursor.v), id: rawCursor.id }
    const result = await this.getMine.execute({ userId: claims.sub, scope, limit, cursor })
    const pagination: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor({ v: result.nextCursor.createdAt.toISOString(), id: result.nextCursor.id }),
      hasMore: result.hasMore,
      limit,
    }
    return ok(result.items.map(toMineAssignmentDto), { pagination })
  }

  @Get(':id')
  @HttpCode(HttpStatus.Ok)
  @Roles('courier', 'customer', 'pharmacist', 'pharmacy_admin', 'support_agent', 'super_admin')
  public async detail(
    @Param('id', UUID_PIPE) assignmentId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<DeliveryAssignmentDetailDto>> {
    const view = await this.getDetail.execute({
      assignmentId,
      actor: { userId: claims.sub, role: claims.role, tenantId: claims.tenantId, pharmacyId: claims.pharmacyId, chainId: claims.chainId },
    })
    return ok(toDeliveryAssignmentDetailDto(view))
  }
}

function parseScope(raw: string | undefined): MineAssignmentsScope {
  if (raw === undefined || raw.trim() === '') {
    return 'active'
  }
  if (!MINE_SCOPE_VALUES.includes(raw as MineAssignmentsScope)) {
    throw new ValidationError('Invalid status query parameter', { status: raw })
  }
  return raw as MineAssignmentsScope
}
