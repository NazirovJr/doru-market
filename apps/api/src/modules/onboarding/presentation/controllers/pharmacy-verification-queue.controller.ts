/**
 * `PharmacyVerificationQueueController` (DTJ-067) — очередь модерации
 * `super_admin` для заявок `pending_review`. Защищён `@Roles('super_admin')` +
 * permission `pharmacy-accounts:approve`.
 */
import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { cursorQuerySchema, decodeCursor, encodeCursor, InvalidCursorError, ok } from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import {
  ListPendingVerificationsUseCase,
  type ListSubjectType,
} from '@/modules/onboarding/application/use-cases/list-pending-verifications.use-case.js'
import { GetPharmacyVerificationDetailUseCase } from '@/modules/onboarding/application/use-cases/get-pharmacy-verification-detail.use-case.js'
import type { QueueCursor } from '@/modules/onboarding/application/ports/verification-queue.types.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })
const QueueQuerySchema = cursorQuerySchema.extend({ status: z.string().min(1).optional() })
type QueueQuery = z.infer<typeof QueueQuerySchema>

@Controller({ path: 'admin/verifications', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class PharmacyVerificationQueueController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `CategoriesController`.
  constructor(
    @Inject(ListPendingVerificationsUseCase) private readonly listPendingVerifications: ListPendingVerificationsUseCase,
    @Inject(GetPharmacyVerificationDetailUseCase) private readonly getPharmacyVerificationDetail: GetPharmacyVerificationDetailUseCase,
  ) {}

  @Get('pharmacy-chains')
  listChains(@Query(new ZodValidationPipe(QueueQuerySchema)) query: QueueQuery): Promise<unknown> {
    return this.list('chain', query)
  }

  @Get('pharmacy-accounts')
  listPharmacies(@Query(new ZodValidationPipe(QueueQuerySchema)) query: QueueQuery): Promise<unknown> {
    return this.list('pharmacy', query)
  }

  @Get('pharmacy-accounts/:id')
  async pharmacyDetail(@Param('id', ID_PARSE_UUID) id: string): Promise<unknown> {
    return ok(await this.getPharmacyVerificationDetail.execute({ pharmacyId: id }))
  }

  private async list(subjectType: ListSubjectType, query: QueueQuery): Promise<unknown> {
    const result = await this.listPendingVerifications.execute({
      subjectType,
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: query.limit,
      cursor: parseQueueCursor(query.cursor),
    })
    return ok({
      items: result.items,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
    })
  }
}

function parseQueueCursor(raw: string | undefined): QueueCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string' || Number.isNaN(Date.parse(decoded.v))) {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}
