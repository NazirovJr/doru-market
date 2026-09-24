/**
 * `CourierRatingsController` (EP-13, DTJ-321, SRS-DELIV-032) — `POST /api/v1/courier-ratings`.
 * Тонкий HTTP-слой (`02` §1.1) — владелец/статус заказа/дубликат проверяются целиком в
 * `SubmitCourierRatingUseCase`.
 *
 * `200`, не `201` — буквальный текст критерия приёмки тикета («Then `200`»), в отличие от общего
 * приёма «POST создаёт ресурс → 201» (`CourierShiftsController.start`) — здесь ЭТО явное
 * требование АС, не общая конвенция.
 *
 * Маппинг ошибок — `AllExceptionsFilter`: `NotFoundError`(404)/`ForbiddenError`(403)/
 * `BusinessRuleViolationError`(422, `order.status !== 'delivered'`)/`RatingAlreadySubmittedError`
 * (409, `RATING_ALREADY_SUBMITTED`, УЖЕ централизован DTJ-313) — все уже в `ERROR_HTTP_STATUS`
 * (`@dorutj/contracts`), этот контроллер их не перехватывает (тот же приём, что
 * `CourierShiftsController`).
 */
import { Body, Controller, HttpCode, Inject, InternalServerErrorException, Post, UseGuards } from '@nestjs/common'
import {
  createCourierRatingRequestSchema,
  ErrorCode,
  ok,
  type CreateCourierRatingRequest,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { SubmitCourierRatingUseCase, type CourierRatingSnapshot } from '../application/use-cases/submit-courier-rating.use-case.js'

@Controller({ path: 'courier-ratings', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class CourierRatingsController {
  // Явный @Inject — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
  public constructor(
    @Inject(SubmitCourierRatingUseCase) private readonly submitRating: SubmitCourierRatingUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.Ok)
  @Roles('customer')
  public async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createCourierRatingRequestSchema)) body: CreateCourierRatingRequest,
  ): Promise<SuccessEnvelope<CourierRatingSnapshot>> {
    const snapshot = await this.submitRating.execute({
      tenantId: requireTenantId(claims),
      customerId: claims.sub,
      orderId: body.orderId,
      rating: body.rating,
      comment: body.comment ?? null,
    })
    return ok(snapshot)
  }
}

/** 1:1 с `RetryPaymentController.requireTenantId` — `super_admin` не входит в `@Roles(...)` этого контроллера. */
function requireTenantId(claims: JwtClaims): string {
  if (claims.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'courier-ratings requires a tenant-scoped actor (super_admin is not in @Roles for this route)',
    })
  }
  return claims.tenantId
}
