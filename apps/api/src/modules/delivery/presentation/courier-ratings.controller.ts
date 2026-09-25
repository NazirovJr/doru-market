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

function requireTenantId(claims: JwtClaims): string {
  if (claims.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'courier-ratings requires a tenant-scoped actor (super_admin is not in @Roles for this route)',
    })
  }
  return claims.tenantId
}
