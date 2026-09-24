import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { ProductEvent, type ProductEventCreateCommand } from '../../domain/product-event.entity.js'
import { PRODUCT_EVENTS_REPOSITORY, type ProductEventsRepositoryPort } from '../ports/product-events-repository.port.js'

export type RecordProductEventCommand = ProductEventCreateCommand

@Injectable()
export class RecordProductEventUseCase {
  public constructor(
    @Inject(PRODUCT_EVENTS_REPOSITORY) private readonly repository: ProductEventsRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // Намеренно не глотает ошибки — граница «сбой аналитики не ломает вызывающего» проведена в AnalyticsFacade.
  public async execute(command: RecordProductEventCommand): Promise<void> {
    const event = ProductEvent.create(command, this.clock.now())
    await this.repository.insert(event)
  }
}
