import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { ProductEvent, type ProductEventCreateCommand } from '../../domain/product-event.entity.js'
import { PRODUCT_EVENTS_REPOSITORY, type ProductEventsRepositoryPort } from '../ports/product-events-repository.port.js'
import { RealizedSavingsCalculator, type RealizedSavingsOrderItem } from '../services/realized-savings-calculator.js'

const ORDER_PLACED_EVENT_TYPE = 'order_placed'

export interface RecordProductEventCommand extends ProductEventCreateCommand {
  /** DTJ-380 — позиции заказа, ТОЛЬКО для `eventType === 'order_placed'` (см. `execute()` ниже); не персистится, `ProductEvent` её не несёт. */
  readonly orderItems?: readonly RealizedSavingsOrderItem[]
}

@Injectable()
export class RecordProductEventUseCase {
  public constructor(
    @Inject(PRODUCT_EVENTS_REPOSITORY) private readonly repository: ProductEventsRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RealizedSavingsCalculator) private readonly realizedSavingsCalculator: RealizedSavingsCalculator,
  ) {}

  // Намеренно не глотает ошибки — граница «сбой аналитики не ломает вызывающего» проведена в AnalyticsFacade.
  public async execute(command: RecordProductEventCommand): Promise<void> {
    const savingsDiram =
      command.eventType === ORDER_PLACED_EVENT_TYPE
        ? await this.realizedSavingsCalculator.calculate({
            orderId: command.orderId ?? '',
            orderItems: command.orderItems ?? [],
            tenantId: command.tenantId,
            sessionId: command.sessionId,
          })
        : (command.savingsDiram ?? null)
    const event = ProductEvent.create({ ...command, savingsDiram }, this.clock.now())
    await this.repository.insert(event)
  }
}
