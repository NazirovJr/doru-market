// RBAC: courier — пул/claim; pharmacy_admin/super_admin — override/дашборд (правило «свой флот» — assign-manual.use-case.ts).
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common'
import {
  assignManualRequestSchema,
  cursorQuerySchema,
  decodeCursor,
  DELIVERY_ASSIGNMENT_STATUS_VALUES,
  encodeCursor,
  ok,
  reassignDeliveryAssignmentRequestSchema,
  ValidationError,
  type AssignManualRequest,
  type DeliveryAssignmentStatus,
  type PaginationMeta,
  type ReassignDeliveryAssignmentRequest,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { GetAvailableDeliveryPoolUseCase, type AvailablePoolItemView } from '../application/use-cases/get-available-delivery-pool.use-case.js'
import { ClaimDeliveryAssignmentUseCase, type ClaimDeliveryAssignmentResult } from '../application/use-cases/claim-delivery-assignment.use-case.js'
import { AssignManualUseCase, type AssignManualResult } from '../application/use-cases/assign-manual.use-case.js'
import { ReassignDeliveryUseCase, type ReassignDeliveryResult } from '../application/use-cases/reassign-delivery.use-case.js'
import {
  ListDeliveryAssignmentsUseCase,
  type DispatchAssignmentView,
  type ListDeliveryAssignmentsResult,
} from '../application/use-cases/list-delivery-assignments.use-case.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })
const DEFAULT_POOL_RADIUS_KM = 5 // ASSUMPTION (ticket «Что сделать» п.1, пример `?radiusKm=5`)

interface DispatchListQueryParams {
  readonly limit?: string
  readonly cursor?: string
  // литеральный ключ — Fastify без qs не разворачивает filter[status][in] во вложенный объект (тот же приём, что delivery-list-query.util.ts)
  readonly 'filter[status][in]'?: string
}

@Controller({ path: 'delivery-assignments', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class DeliveryAssignmentsDispatchController {
  // eslint-disable-next-line max-params -- 5 DI-инъекций use case'ов, явные @Inject
  public constructor(
    @Inject(GetAvailableDeliveryPoolUseCase) private readonly getPool: GetAvailableDeliveryPoolUseCase,
    @Inject(ClaimDeliveryAssignmentUseCase) private readonly claim: ClaimDeliveryAssignmentUseCase,
    @Inject(AssignManualUseCase) private readonly assignManual: AssignManualUseCase,
    @Inject(ReassignDeliveryUseCase) private readonly reassign: ReassignDeliveryUseCase,
    @Inject(ListDeliveryAssignmentsUseCase) private readonly list: ListDeliveryAssignmentsUseCase,
  ) {}

  @Get('available-pool')
  @Roles('courier')
  public async availablePool(
    @CurrentUser() claims: JwtClaims,
    @Query('radiusKm') radiusKmRaw: string | undefined,
  ): Promise<SuccessEnvelope<readonly AvailablePoolItemView[]>> {
    const items = await this.getPool.execute({ userId: claims.sub, radiusKm: parseRadiusKm(radiusKmRaw) })
    return ok(items)
  }

  @Post(':id/claim')
  @HttpCode(HttpStatus.Ok)
  @Roles('courier')
  public async claimAssignment(
    @Param('id', UUID_PIPE) assignmentId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<ClaimDeliveryAssignmentResult>> {
    const result = await this.claim.execute({ assignmentId, userId: claims.sub })
    return ok(result)
  }

  @Post(':id/assign-manual')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacy_admin', 'super_admin')
  public async assignManualAction(
    @Param('id', UUID_PIPE) assignmentId: string,
    @Body(new ZodValidationPipe(assignManualRequestSchema)) body: AssignManualRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<AssignManualResult>> {
    const result = await this.assignManual.execute({
      assignmentId,
      courierId: body.courierId,
      reason: body.reason,
      actor: { userId: claims.sub, role: claims.role, chainId: claims.chainId },
    })
    return ok(result)
  }

  @Post(':id/reassign')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacy_admin', 'super_admin')
  public async reassignAction(
    @Param('id', UUID_PIPE) assignmentId: string,
    @Body(new ZodValidationPipe(reassignDeliveryAssignmentRequestSchema)) body: ReassignDeliveryAssignmentRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<ReassignDeliveryResult>> {
    const result = await this.reassign.execute({
      assignmentId,
      newCourierId: body.courierId,
      reason: body.reason,
      actor: { userId: claims.sub, role: claims.role, chainId: claims.chainId },
    })
    return ok(result)
  }

  @Get()
  @Roles('pharmacy_admin', 'super_admin')
  public async listAssignments(
    @CurrentUser() claims: JwtClaims,
    @Query() query: DispatchListQueryParams,
  ): Promise<SuccessEnvelope<readonly DispatchAssignmentView[]>> {
    const { limit, cursor } = parseListQuery(query.limit, query.cursor)
    const result: ListDeliveryAssignmentsResult = await this.list.execute({
      statuses: parseStatusesFilter(query['filter[status][in]']),
      limit,
      cursor,
      actor: { role: claims.role, chainId: claims.chainId },
    })
    const pagination: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor({ v: result.nextCursor.createdAt.toISOString(), id: result.nextCursor.id }),
      hasMore: result.hasMore,
      limit,
    }
    return ok(result.items, { pagination })
  }
}

function parseRadiusKm(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_POOL_RADIUS_KM
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ValidationError('Invalid radiusKm query parameter', { radiusKm: raw })
  }
  return parsed
}

function parseStatusesFilter(raw: string | undefined): readonly DeliveryAssignmentStatus[] {
  if (raw === undefined || raw.trim() === '') {
    return DELIVERY_ASSIGNMENT_STATUS_VALUES
  }
  const values = raw.split(',').map((value) => value.trim())
  for (const value of values) {
    if (!DELIVERY_ASSIGNMENT_STATUS_VALUES.includes(value as DeliveryAssignmentStatus)) {
      throw new ValidationError('Invalid filter[status][in] value', { value })
    }
  }
  return values as DeliveryAssignmentStatus[]
}

function parseListQuery(
  limitRaw: string | undefined,
  cursorRaw: string | undefined,
): { readonly limit: number; readonly cursor: { readonly createdAt: Date; readonly id: string } | null } {
  const parsed = cursorQuerySchema.safeParse({ limit: limitRaw, cursor: cursorRaw })
  if (!parsed.success) {
    throw new ValidationError('Invalid limit/cursor query parameters', { issues: parsed.error.issues })
  }
  if (parsed.data.cursor === undefined) {
    return { limit: parsed.data.limit, cursor: null }
  }
  const decoded = decodeCursor(parsed.data.cursor)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new ValidationError('Cannot decode cursor', { raw: parsed.data.cursor })
  }
  return { limit: parsed.data.limit, cursor: { createdAt: new Date(decoded.v), id: decoded.id } }
}

