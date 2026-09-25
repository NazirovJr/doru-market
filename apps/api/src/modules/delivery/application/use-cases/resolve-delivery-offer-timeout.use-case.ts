// Идемпотентен: оффер уже не pending (курьер ответил раньше таймера) -> no-op, не бросает.
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import { DELIVERY_OFFER_REPOSITORY, type DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import { DELIVERY_UNIT_OF_WORK, type DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { EscalateDeliveryOfferService } from '../services/escalate-delivery-offer.service.js'

export interface ResolveDeliveryOfferTimeoutCommand {
  readonly offerId: string
}

@Injectable()
export class ResolveDeliveryOfferTimeoutUseCase {
  // eslint-disable-next-line max-params -- 5 DI-инъекций, явные @Inject (DTJ-001)
  public constructor(
    @Inject(DELIVERY_OFFER_REPOSITORY) private readonly offers: DeliveryOfferRepositoryPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(EscalateDeliveryOfferService) private readonly escalate: EscalateDeliveryOfferService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(cmd: ResolveDeliveryOfferTimeoutCommand): Promise<void> {
    await this.uow.run(async (tx) => {
      const offer = await this.offers.findByIdForUpdate(cmd.offerId, tx)
      if (offer?.status !== 'pending') {
        return // отвечено раньше срабатывания таймера — idempotent no-op
      }
      offer.expire(this.clock.now())
      await this.offers.save(offer, tx)
      for (const event of offer.pullDomainEvents()) {
        // eslint-disable-next-line no-await-in-loop -- одна транзакция/соединение, порядок важен
        await this.outbox.append(event, null, tx)
      }
      await this.escalate.execute(offer.deliveryAssignmentId, tx)
    })
  }
}
