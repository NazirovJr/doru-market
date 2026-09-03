/**
 * `PharmacyVerificationDecisionsController` (DTJ-068) — 8 маршрутов решений
 * оператора `super_admin` (4 действия × 2 типа сущности).
 *
 * Тела: `approve` — `{ checklist: Record<string,boolean>, notes?: string }`,
 * остальные — `{ reason: string }` (обязательное).
 */
import { Body, Controller, Inject, Param, ParseUUIDPipe, Post, UseGuards, UsePipes } from '@nestjs/common'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import {
  ApproveVerificationRequestSchema,
  ok,
  RejectVerificationRequestSchema,
  RequestChangesVerificationRequestSchema,
  TerminateVerificationRequestSchema,
  type ApproveVerificationRequest,
  type RejectVerificationRequest,
  type RequestChangesVerificationRequest,
  type TerminateVerificationRequest,
} from '@dorutj/contracts'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import { ReviewChainApplicationUseCase } from '@/modules/onboarding/application/use-cases/review-chain-application.use-case.js'
import { ReviewPharmacyApplicationUseCase } from '@/modules/onboarding/application/use-cases/review-pharmacy-application.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'admin/verifications', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class PharmacyVerificationDecisionsController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `CategoriesController`.
  constructor(
    @Inject(ReviewChainApplicationUseCase) private readonly reviewChainApplication: ReviewChainApplicationUseCase,
    @Inject(ReviewPharmacyApplicationUseCase) private readonly reviewPharmacyApplication: ReviewPharmacyApplicationUseCase,
  ) {}

  // -------- chain decisions --------

  @Post('pharmacy-chains/:id/approve')
  @UsePipes(new ZodValidationPipe(ApproveVerificationRequestSchema))
  async approveChain(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: ApproveVerificationRequest,
  ): Promise<unknown> {
    const result = await this.reviewChainApplication.approve({
      chainId: id,
      actorId: '00000000-0000-0000-0000-000000000000',
      checklist: body.checklist,
      notes: body.notes ?? null,
    })
    return ok(result)
  }

  @Post('pharmacy-chains/:id/request-changes')
  @UsePipes(new ZodValidationPipe(RequestChangesVerificationRequestSchema))
  async requestChangesChain(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: RequestChangesVerificationRequest,
  ): Promise<unknown> {
    const result = await this.reviewChainApplication.requestChanges({
      chainId: id,
      actorId: '00000000-0000-0000-0000-000000000000',
      reason: body.reason,
    })
    return ok(result)
  }

  @Post('pharmacy-chains/:id/reject')
  @UsePipes(new ZodValidationPipe(RejectVerificationRequestSchema))
  async rejectChain(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: RejectVerificationRequest,
  ): Promise<unknown> {
    const result = await this.reviewChainApplication.reject({
      chainId: id,
      actorId: '00000000-0000-0000-0000-000000000000',
      reason: body.reason,
    })
    return ok(result)
  }

  @Post('pharmacy-chains/:id/terminate')
  @UsePipes(new ZodValidationPipe(TerminateVerificationRequestSchema))
  async terminateChain(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: TerminateVerificationRequest,
  ): Promise<unknown> {
    const result = await this.reviewChainApplication.terminate({
      chainId: id,
      actorId: '00000000-0000-0000-0000-000000000000',
      reason: body.reason,
    })
    return ok(result)
  }

  // -------- pharmacy decisions --------

  @Post('pharmacy-accounts/:id/approve')
  @UsePipes(new ZodValidationPipe(ApproveVerificationRequestSchema))
  async approvePharmacy(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: ApproveVerificationRequest,
  ): Promise<unknown> {
    const result = await this.reviewPharmacyApplication.approve({
      pharmacyId: id,
      actorId: '00000000-0000-0000-0000-000000000000',
      checklist: body.checklist,
      notes: body.notes ?? null,
    })
    return ok(result)
  }

  @Post('pharmacy-accounts/:id/request-changes')
  @UsePipes(new ZodValidationPipe(RequestChangesVerificationRequestSchema))
  async requestChangesPharmacy(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: RequestChangesVerificationRequest,
  ): Promise<unknown> {
    const result = await this.reviewPharmacyApplication.requestChanges({
      pharmacyId: id,
      actorId: '00000000-0000-0000-0000-000000000000',
      reason: body.reason,
    })
    return ok(result)
  }

  @Post('pharmacy-accounts/:id/reject')
  @UsePipes(new ZodValidationPipe(RejectVerificationRequestSchema))
  async rejectPharmacy(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: RejectVerificationRequest,
  ): Promise<unknown> {
    const result = await this.reviewPharmacyApplication.reject({
      pharmacyId: id,
      actorId: '00000000-0000-0000-0000-000000000000',
      reason: body.reason,
    })
    return ok(result)
  }

  @Post('pharmacy-accounts/:id/terminate')
  @UsePipes(new ZodValidationPipe(TerminateVerificationRequestSchema))
  async terminatePharmacy(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: TerminateVerificationRequest,
  ): Promise<unknown> {
    const result = await this.reviewPharmacyApplication.terminate({
      pharmacyId: id,
      actorId: '00000000-0000-0000-0000-000000000000',
      reason: body.reason,
    })
    return ok(result)
  }
}
