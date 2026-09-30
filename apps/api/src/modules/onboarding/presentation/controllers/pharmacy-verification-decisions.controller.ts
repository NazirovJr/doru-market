/**
 * `PharmacyVerificationDecisionsController` (DTJ-068) — 8 маршрутов решений
 * оператора `super_admin` (4 действия × 2 типа сущности).
 *
 * Тела: `approve` — `{ checklist: Record<string,boolean>, notes?: string }`,
 * остальные — `{ reason: string }` (обязательное).
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
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
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
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
  @HttpCode(HttpStatus.OK)
  async approveChain(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(ApproveVerificationRequestSchema)) body: ApproveVerificationRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const result = await this.reviewChainApplication.approve({
      chainId: id,
      actorId: claims.sub,
      checklist: body.checklist,
      notes: body.notes ?? null,
    })
    return ok(result)
  }

  @Post('pharmacy-chains/:id/request-changes')
  @HttpCode(HttpStatus.OK)
  async requestChangesChain(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(RequestChangesVerificationRequestSchema)) body: RequestChangesVerificationRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const result = await this.reviewChainApplication.requestChanges({
      chainId: id,
      actorId: claims.sub,
      reason: body.reason,
    })
    return ok(result)
  }

  @Post('pharmacy-chains/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectChain(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(RejectVerificationRequestSchema)) body: RejectVerificationRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const result = await this.reviewChainApplication.reject({
      chainId: id,
      actorId: claims.sub,
      reason: body.reason,
    })
    return ok(result)
  }

  @Post('pharmacy-chains/:id/terminate')
  @HttpCode(HttpStatus.OK)
  async terminateChain(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(TerminateVerificationRequestSchema)) body: TerminateVerificationRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const result = await this.reviewChainApplication.terminate({
      chainId: id,
      actorId: claims.sub,
      reason: body.reason,
    })
    return ok(result)
  }

  // -------- pharmacy decisions --------

  @Post('pharmacy-accounts/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approvePharmacy(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(ApproveVerificationRequestSchema)) body: ApproveVerificationRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const result = await this.reviewPharmacyApplication.approve({
      pharmacyId: id,
      actorId: claims.sub,
      checklist: body.checklist,
      notes: body.notes ?? null,
    })
    return ok(result)
  }

  @Post('pharmacy-accounts/:id/request-changes')
  @HttpCode(HttpStatus.OK)
  async requestChangesPharmacy(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(RequestChangesVerificationRequestSchema)) body: RequestChangesVerificationRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const result = await this.reviewPharmacyApplication.requestChanges({
      pharmacyId: id,
      actorId: claims.sub,
      reason: body.reason,
    })
    return ok(result)
  }

  @Post('pharmacy-accounts/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectPharmacy(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(RejectVerificationRequestSchema)) body: RejectVerificationRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const result = await this.reviewPharmacyApplication.reject({
      pharmacyId: id,
      actorId: claims.sub,
      reason: body.reason,
    })
    return ok(result)
  }

  @Post('pharmacy-accounts/:id/terminate')
  @HttpCode(HttpStatus.OK)
  async terminatePharmacy(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(TerminateVerificationRequestSchema)) body: TerminateVerificationRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const result = await this.reviewPharmacyApplication.terminate({
      pharmacyId: id,
      actorId: claims.sub,
      reason: body.reason,
    })
    return ok(result)
  }
}
