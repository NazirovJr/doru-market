/**
 * `PharmacyAccountsPublicController` (DTJ-065) — публичный (без JWT, `@Public()`)
 * контроллер заявки аптечной точки.
 *
 * Маршруты:
 * - `POST /api/v1/pharmacy-accounts` — `SubmitPharmacyApplicationUseCase`
 * - `POST /api/v1/pharmacy-accounts/:id/submit` — DTJ-066, `submitForReview`
 */
import { Body, Controller, Inject, Param, ParseUUIDPipe, Post, UsePipes } from '@nestjs/common'
import { Public } from '@/common/decorators/public.decorator.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import {
  ok,
  SubmitPharmacyApplicationRequestSchema,
  SubmitPharmacyForReviewRequestSchema,
  type SubmitPharmacyApplicationRequest,
} from '@dorutj/contracts'
import { SubmitPharmacyApplicationUseCase, type SubmitPharmacyApplicationInput } from '@/modules/onboarding/application/use-cases/submit-pharmacy-application.use-case.js'
import { SubmitPharmacyForReviewUseCase } from '@/modules/onboarding/application/use-cases/submit-pharmacy-for-review.use-case.js'
import { RequestReactivationUseCase } from '@/modules/onboarding/application/use-cases/request-reactivation.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'pharmacy-accounts', version: '1' })
@Public()
export class PharmacyAccountsPublicController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `CategoriesController`.
  constructor(
    @Inject(SubmitPharmacyApplicationUseCase) private readonly submitPharmacyApplication: SubmitPharmacyApplicationUseCase,
    @Inject(SubmitPharmacyForReviewUseCase) private readonly submitPharmacyForReview: SubmitPharmacyForReviewUseCase,
    @Inject(RequestReactivationUseCase) private readonly requestReactivation: RequestReactivationUseCase,
  ) {}

  @Post()
  async submit(
    @Body(new ZodValidationPipe(SubmitPharmacyApplicationRequestSchema)) body: SubmitPharmacyApplicationRequest,
  ): Promise<unknown> {
    const input: SubmitPharmacyApplicationInput = {
      id: globalThis.crypto.randomUUID(),
      chainId: body.chainId ?? null,
      tinInn: body.tinInn,
      name: body.name,
      addressText: body.addressText,
      landmarkTj: body.landmarkTj ?? null,
      latitude: body.latitude,
      longitude: body.longitude,
      phone: body.phone,
      isOpen247: body.isOpen247,
      openingTime: body.openingTime ?? null,
      closingTime: body.closingTime ?? null,
      licenseNumber: body.licenseNumber,
      licenseIssuingAuthority: body.licenseIssuingAuthority ?? null,
      licenseIssueDate: body.licenseIssueDate === undefined || body.licenseIssueDate === null ? null : new Date(body.licenseIssueDate),
      licenseExpiryDate: new Date(body.licenseExpiryDate),
      licenseScanUrl: body.licenseScanUrl ?? null,
      pharmacistInChargeName: body.pharmacistInChargeName,
    }
    const result = await this.submitPharmacyApplication.execute(input)
    return ok(result)
  }

  /** `POST /:id/submit` — DTJ-066: переход `draft → pending_review`. */
  @Post(':id/submit')
  @UsePipes(new ZodValidationPipe(SubmitPharmacyForReviewRequestSchema))
  async submitForReview(@Param('id', ID_PARSE_UUID) id: string): Promise<unknown> {
    const result = await this.submitPharmacyForReview.execute({ pharmacyId: id })
    return ok(result)
  }

  /** `POST /:id/request-reactivation` — DTJ-074: `suspended → pending_review`. */
  @Post(':id/request-reactivation')
  @UsePipes(new ZodValidationPipe(SubmitPharmacyForReviewRequestSchema))
  async requestReactivationRoute(@Param('id', ID_PARSE_UUID) id: string): Promise<unknown> {
    const result = await this.requestReactivation.execute({
      pharmacyId: id,
      actorId: '00000000-0000-0000-0000-000000000000',
    })
    return ok(result)
  }
}
