/**
 * `FeatureFlagsController` (EP-15, DTJ-352, SRS-ADM-028) — `/api/v1/feature-flags`.
 * `@Roles('super_admin')` на уровне класса — ВСЕ три маршрута требуют этой роли (ticket
 * «Что сделать» п.6, в отличие от `SupportTicketsController`, где по умолчанию доступ шире).
 *
 * `PATCH /:id` использует ТУ ЖЕ `UpsertFeatureFlagSchema`, что `POST /` (полная замена, не
 * частичный patch) — см. JSDoc `packages/contracts/src/admin/feature-flags.ts` про причину.
 *
 * Ошибки маппятся в HTTP глобальным `AllExceptionsFilter` (`ValidationError` → 400,
 * `ConflictError` → 409) — контроллер не содержит `try/catch` (C12, `02` §1.3).
 */
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import {
  cursorQuerySchema,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  ok,
  UpsertFeatureFlagSchema,
  type CursorQuery,
  type FeatureFlagDto,
  type PaginationMeta,
  type SuccessEnvelope,
  type UpsertFeatureFlagDto,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import type { FeatureFlagsListCursor } from '../application/ports/feature-flags-repository.port.js'
import { ListFeatureFlagsUseCase, type FeatureFlagView } from '../application/use-cases/list-feature-flags.use-case.js'
import { UpsertFeatureFlagUseCase, type UpsertFeatureFlagCommand } from '../application/use-cases/upsert-feature-flag.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'feature-flags', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class FeatureFlagsController {
  public constructor(
    @Inject(ListFeatureFlagsUseCase) private readonly listFlags: ListFeatureFlagsUseCase,
    @Inject(UpsertFeatureFlagUseCase) private readonly upsertFlag: UpsertFeatureFlagUseCase,
  ) {}

  @Get()
  public async list(
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ): Promise<SuccessEnvelope<readonly FeatureFlagDto[]>> {
    const result = await this.listFlags.execute({ limit: query.limit, cursor: parseListCursor(query.cursor) })
    const meta: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }
    return ok(result.items.map(toFeatureFlagDto), { pagination: meta })
  }

  @Post()
  @HttpCode(HttpStatus.Created)
  public async create(
    @Body(new ZodValidationPipe(UpsertFeatureFlagSchema)) body: UpsertFeatureFlagDto,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<FeatureFlagDto>> {
    const view = await this.upsertFlag.execute(toUpsertCommand(body, claims))
    return ok(toFeatureFlagDto(view))
  }

  @Patch(':id')
  public async update(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(UpsertFeatureFlagSchema)) body: UpsertFeatureFlagDto,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<FeatureFlagDto>> {
    const view = await this.upsertFlag.execute({ id, ...toUpsertCommand(body, claims) })
    return ok(toFeatureFlagDto(view))
  }
}

/**
 * `exactOptionalPropertyTypes` — `description` включается ТОЛЬКО когда задан (Zod
 * `.optional()` даёт `string | undefined`, а не `string | null`, отличную от отсутствия ключа
 * семантику), тот же приём, что `support-tickets.controller.ts` для `orderId`.
 */
function toUpsertCommand(body: UpsertFeatureFlagDto, claims: JwtClaims): Omit<UpsertFeatureFlagCommand, 'id'> {
  return {
    flagKey: body.flagKey,
    scope: body.scope,
    tenantId: body.tenantId ?? null,
    isEnabled: body.isEnabled,
    rolloutPercentage: body.rolloutPercentage,
    ...(body.description !== undefined && { description: body.description }),
    actor: { userId: claims.sub },
  }
}

/** 1:1 приём с `support-tickets-query.util.ts#parseListCursor` (DTJ-282). */
function parseListCursor(raw: string | undefined): FeatureFlagsListCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}

function toFeatureFlagDto(view: FeatureFlagView): FeatureFlagDto {
  return {
    id: view.id,
    flagKey: view.flagKey,
    scope: view.scope,
    tenantId: view.tenantId,
    isEnabled: view.isEnabled,
    rolloutPercentage: view.rolloutPercentage,
    description: view.description,
    updatedBy: view.updatedBy,
    updatedAt: view.updatedAt.toISOString(),
  }
}
