import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import { DELIVERY_OFFER_REPOSITORY, type DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { DELIVERY_UNIT_OF_WORK, type DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { EscalateDeliveryOfferService } from '../services/escalate-delivery-offer.service.js'

export interface DeclineDeliveryOfferCommand {
  readonly offerId: string
  readonly userId: string
  readonly reason: string | null
}

@Injectable()
export class DeclineDeliveryOfferUseCase {
  // eslint-disable-next-line max-params -- 5 DI-инъекций, явные @Inject (DTJ-001)
  public constructor(
    @Inject(DELIVERY_OFFER_REPOSITORY) private readonly offers: DeliveryOfferRepositoryPort,
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(EscalateDeliveryOfferService) private readonly escalate: EscalateDeliveryOfferService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(cmd: DeclineDeliveryOfferCommand): Promise<void> {
    const courier = await this.couriers.findByUserId(cmd.userId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', userId: cmd.userId })
    }
    await this.uow.run(async (tx) => {
      const offer = await this.offers.findByIdForUpdate(cmd.offerId, tx)
      if (offer === null) {
        throw new NotFoundError({ resource: 'delivery_offer', offerId: cmd.offerId })
      }
      if (offer.courierId !== courier.id) {
        throw new ForbiddenError('Offer does not belong to this courier', { offerId: cmd.offerId })
      }
      offer.decline(cmd.reason, this.clock.now())
      await this.offers.save(offer, tx)
      await this.escalate.execute(offer.deliveryAssignmentId, tx)
    })
  }
}
