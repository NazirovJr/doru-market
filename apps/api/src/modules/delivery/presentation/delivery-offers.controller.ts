// RBAC: роль courier, только собственные офферы (courierId резолвится use case'ом из JWT sub).
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common'
import { declineDeliveryOfferRequestSchema, ok, type DeclineDeliveryOfferRequest, type SuccessEnvelope } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { GetPendingDeliveryOffersUseCase } from '../application/use-cases/get-pending-delivery-offers.use-case.js'
import { AcceptDeliveryOfferUseCase, type AcceptDeliveryOfferResult } from '../application/use-cases/accept-delivery-offer.use-case.js'
import { DeclineDeliveryOfferUseCase } from '../application/use-cases/decline-delivery-offer.use-case.js'
import { toPendingOfferDto, type PendingOfferDto } from './delivery-offer.dto.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'delivery-offers', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class DeliveryOffersController {
  public constructor(
    @Inject(GetPendingDeliveryOffersUseCase) private readonly getPending: GetPendingDeliveryOffersUseCase,
    @Inject(AcceptDeliveryOfferUseCase) private readonly accept: AcceptDeliveryOfferUseCase,
    @Inject(DeclineDeliveryOfferUseCase) private readonly decline: DeclineDeliveryOfferUseCase,
  ) {}

  @Get()
  @Roles('courier')
  public async list(
    @CurrentUser() claims: JwtClaims,
    @Query('status') _status: string | undefined,
  ): Promise<SuccessEnvelope<readonly PendingOfferDto[]>> {
    const views = await this.getPending.execute(claims.sub)
    return ok(views.map(toPendingOfferDto))
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.Ok)
  @Roles('courier')
  public async acceptOffer(
    @Param('id', UUID_PIPE) offerId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<AcceptDeliveryOfferResult>> {
    const result = await this.accept.execute({ offerId, userId: claims.sub })
    return ok(result)
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.Ok)
  @Roles('courier')
  public async declineOffer(
    @Param('id', UUID_PIPE) offerId: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(declineDeliveryOfferRequestSchema)) body: DeclineDeliveryOfferRequest,
  ): Promise<SuccessEnvelope<null>> {
    await this.decline.execute({ offerId, userId: claims.sub, reason: body.reason ?? null })
    return ok(null)
  }
}
