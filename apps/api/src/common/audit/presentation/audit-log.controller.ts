// Единственная точка чтения audit_log — @Roles('super_admin') без других ролей, RolesGuard отклоняет всех прочих до входа в use case.
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import {
  AuditLogListQuerySchema,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  ok,
  type AuditLogEntryDto,
  type AuditLogListQueryDto,
  type PaginationMeta,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import type { AuditLogEntryView, AuditLogFilter, AuditLogListCursor } from '../audit-log-query.port.js'
import { ListAuditLogUseCase } from '../application/use-cases/list-audit-log.use-case.js'

@Controller({ version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class AuditLogController {
  public constructor(@Inject(ListAuditLogUseCase) private readonly listAuditLogUseCase: ListAuditLogUseCase) {}

  @Get('audit-log')
  public async list(
    @Query(new ZodValidationPipe(AuditLogListQuerySchema)) query: AuditLogListQueryDto,
  ): Promise<SuccessEnvelope<readonly AuditLogEntryDto[]>> {
    const result = await this.listAuditLogUseCase.execute({
      filter: toFilter(query),
      limit: query.limit,
      cursor: parseListCursor(query.cursor),
    })
    const meta: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }
    return ok(result.items.map(toEntryDto), { pagination: meta })
  }
}

function toFilter(query: AuditLogListQueryDto): AuditLogFilter {
  return {
    ...(query.category !== undefined && { category: query.category }),
    ...(query.entityType !== undefined && { entityType: query.entityType }),
    ...(query.entityId !== undefined && { entityId: query.entityId }),
    ...(query.actorUserId !== undefined && { actorUserId: query.actorUserId }),
    ...(query.tenantId !== undefined && { tenantId: query.tenantId }),
    ...(query.createdAtFrom !== undefined && { createdAtFrom: query.createdAtFrom }),
    ...(query.createdAtTo !== undefined && { createdAtTo: query.createdAtTo }),
  }
}

function parseListCursor(raw: string | undefined): AuditLogListCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}

function toEntryDto(view: AuditLogEntryView): AuditLogEntryDto {
  return {
    id: view.id,
    category: view.category,
    entityType: view.entityType,
    entityId: view.entityId,
    actorUserId: view.actorUserId,
    action: view.action,
    reason: view.reason,
    metadata: view.metadata,
    tenantId: view.tenantId,
    createdAt: view.createdAt.toISOString(),
  }
}
