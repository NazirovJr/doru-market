// Вызывающий — исключительно apps/worker (delivery-offer-timeout.job.ts), тот же мост, что PartialFulfillmentTimeoutController.
import { Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { ResolveDeliveryOfferTimeoutUseCase } from '@/modules/delivery/application/use-cases/resolve-delivery-offer-timeout.use-case.js'
import { DeliveryInternalServiceGuard } from './delivery-internal-service.guard.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'internal/delivery-offers', version: '1' })
@UseGuards(DeliveryInternalServiceGuard)
export class DeliveryOfferTimeoutController {
  public constructor(
    @Inject(ResolveDeliveryOfferTimeoutUseCase) private readonly resolveTimeout: ResolveDeliveryOfferTimeoutUseCase,
  ) {}

  @Post(':id/resolve-timeout')
  @HttpCode(HttpStatus.OK)
  public async resolveTimeoutOffer(@Param('id', ID_PARSE_UUID) offerId: string): Promise<SuccessEnvelope<null>> {
    await this.resolveTimeout.execute({ offerId })
    return ok(null)
  }
}
