/**
 * `InventorySyncBatchesReportController` (EP-05, DTJ-163, SRS-INV-043/044/046).
 *
 * Read-модель отчёта кабинета аптеки для ЧЕЛОВЕЧЕСКОЙ роли (`pharmacist`/`pharmacy_admin`/
 * `super_admin`) — в отличие от `InventorySyncBatchStatusController` (DTJ-158), который
 * обслуживает системный принципал `pharmacy_system` через `PharmacyApiKeyGuard`. Три маршрута:
 *
 *   - `GET /inventory-sync-batches` — курсорный список (SRS-INV-043, `SRS-API-004` пагинация).
 *   - `GET /inventory-sync-batches/:batchId/errors` — построчные ошибки батча, локализованные
 *     (SRS-INV-044).
 *   - `GET /inventory-sync-batches/pending-moderation-count?pharmacyId=...` — число ожидающих
 *     модерации записей (SRS-INV-046), БЕЗ доступа к самой очереди.
 *
 * **Порядок маршрутов НЕ создаёт коллизию с DTJ-158** (тот же базовый путь
 * `inventory-sync-batches`, ДРУГОЙ класс контроллера): Fastify/`find-my-way` отдаёт приоритет
 * СТАТИЧЕСКИМ сегментам (`pending-moderation-count`) над параметрическими (`:batchId` из
 * DTJ-158) на той же глубине пути — устоявшаяся, документированная гарантия роутера, не
 * специфичное для Nest поведение. `:batchId/errors` (2 сегмента) структурно не пересекается с
 * `:batchId` DTJ-158 (1 сегмент). **Не проверено живым HTTP-вызовом в этой сессии** (юнит-тесты
 * вызывают методы контроллеров напрямую, минуя роутер, см. `docs/07-WAVE4-HANDOFF.md` §3.2 про
 * этот класс дефектов) — зафиксировать как остаточный интеграционный риск для координатора.
 *
 * Скоуп по роли и локализация `errorCode → message` — целиком в
 * `InventorySyncReportQueryService` (application), контроллер только парсит HTTP и
 * форматирует ответ (`02-CLEAN-ARCHITECTURE-AND-CODE.md`, presentation не содержит бизнес-правил).
 */
import { Controller, Get, HttpException, HttpStatus, Inject, Param, Query, Headers, UseGuards } from '@nestjs/common'
import {
  ErrorCode,
  InvalidCursorError,
  ValidationError,
  cursorQuerySchema,
  decodeCursor,
  encodeCursor,
  fail,
  ok,
  type PaginationMeta,
} from '@dorutj/contracts'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import {
  InventorySyncReportQueryService,
  type InventoryReportActor,
  type InventorySyncBatchListItemResult,
} from '@/modules/inventory/application/services/inventory-sync-report-query.service.js'
import { resolveLocale } from '../http/resolve-locale.util.js'

const REPORT_ROLES = ['pharmacist', 'pharmacy_admin', 'super_admin'] as const

interface ParsedCursor {
  readonly v: string
  readonly id: string
}

/** Тот же приём, что `pharmacy-accounts-report-query.util.ts` (payments) — не импортируется напрямую (D-27, cross-module). */
function parseListQuery(limitRaw: string | undefined, cursorRaw: string | undefined): { readonly limit: number; readonly cursor: ParsedCursor | null } {
  const parsed = cursorQuerySchema.safeParse({ limit: limitRaw, cursor: cursorRaw })
  if (!parsed.success) {
    throw new ValidationError('Invalid limit/cursor query parameters', { issues: parsed.error.issues })
  }
  const { limit, cursor: rawCursor } = parsed.data
  if (rawCursor === undefined) {
    return { limit, cursor: null }
  }
  const decoded = decodeCursor(rawCursor)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${rawCursor}"`, { raw: rawCursor })
  }
  return { limit, cursor: { v: decoded.v, id: decoded.id } }
}

function toActor(claims: JwtClaims): InventoryReportActor {
  return { role: claims.role, pharmacyId: claims.pharmacyId, chainId: claims.chainId }
}

@Controller({ path: 'inventory-sync-batches', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...REPORT_ROLES)
export class InventorySyncBatchesReportController {
  constructor(
    @Inject(InventorySyncReportQueryService)
    private readonly reportQuery: InventorySyncReportQueryService,
  ) {}

  /** `@Query() rawQuery` (не 3 отдельных `@Query(name)`, C1 `max-params`) — тот же приём, что `AnalogsController`. */
  @Get()
  async list(@Query() rawQuery: Record<string, string | undefined>, @CurrentUser() claims: JwtClaims): Promise<unknown> {
    const { limit, cursor } = parseListQuery(rawQuery.limit, rawQuery.cursor)
    const filterPharmacyIdRaw = rawQuery['filter[pharmacyId]']
    const result = await this.reportQuery.listBatchesForReport({
      actor: toActor(claims),
      filterPharmacyId: filterPharmacyIdRaw ?? null,
      cursor,
      limit,
    })
    const pagination: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit,
    }
    return ok(result.items.map(toListItemDto), { pagination })
  }

  @Get('pending-moderation-count')
  async pendingModerationCount(
    @Query('pharmacyId') pharmacyIdRaw: string | undefined,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    if (pharmacyIdRaw === undefined || pharmacyIdRaw.length === 0) {
      throw new HttpException(
        fail(ErrorCode.VALIDATION_ERROR, 'pharmacyId query parameter is required', { field: 'pharmacyId' }),
        HttpStatus.BAD_REQUEST,
      )
    }
    const pendingCount = await this.reportQuery.getPendingModerationCount({
      pharmacyId: pharmacyIdRaw,
      actor: toActor(claims),
    })
    if (pendingCount === null) {
      throw notFound()
    }
    return ok({ pendingCount })
  }

  // Статический сегмент "upload" перед :sourceUploadId не коллизирует с односегментным :batchId DTJ-158 — роутер отдаёт приоритет статическим сегментам.
  @Get('upload/:sourceUploadId')
  async byUpload(@Param('sourceUploadId') sourceUploadId: string, @CurrentUser() claims: JwtClaims): Promise<unknown> {
    const items = await this.reportQuery.listBatchesForSourceUpload({ sourceUploadId, actor: toActor(claims) })
    if (items === null) {
      throw notFound()
    }
    return ok(items.map(toListItemDto))
  }

  @Get(':batchId/errors')
  async errors(
    @Param('batchId') batchId: string,
    @CurrentUser() claims: JwtClaims,
    @Headers('accept-language') acceptLanguage: string | undefined,
  ): Promise<unknown> {
    const errors = await this.reportQuery.getRowErrorsForActor({
      batchId,
      actor: toActor(claims),
      locale: resolveLocale(acceptLanguage),
    })
    if (errors === null) {
      throw notFound()
    }
    return ok(errors)
  }
}

function notFound(): HttpException {
  return new HttpException(fail(ErrorCode.NOT_FOUND, 'inventory sync batch not found'), HttpStatus.NOT_FOUND)
}

function toListItemDto(item: InventorySyncBatchListItemResult): Record<string, unknown> {
  return {
    batchId: item.batchId,
    channel: item.channel,
    syncType: item.syncType,
    status: item.status,
    totalRows: item.totalRows,
    acceptedRows: item.acceptedRows,
    rejectedRows: item.rejectedRows,
    receivedAt: item.receivedAt.toISOString(),
    completedAt: item.completedAt === null ? null : item.completedAt.toISOString(),
    sourceUploadId: item.sourceUploadId,
  }
}
