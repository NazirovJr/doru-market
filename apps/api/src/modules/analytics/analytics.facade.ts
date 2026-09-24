import { Inject, Injectable, Logger } from '@nestjs/common'
import { RecordProductEventUseCase, type RecordProductEventCommand } from './application/use-cases/record-product-event.use-case.js'

@Injectable()
export class AnalyticsFacade {
  private readonly logger = new Logger(AnalyticsFacade.name)

  public constructor(
    @Inject(RecordProductEventUseCase) private readonly recordProductEvent: RecordProductEventUseCase,
  ) {}

  // Сбой телеметрии не должен ломать бизнес-операцию вызывающего модуля — лог, не исключение наружу.
  public async recordEvent(command: RecordProductEventCommand): Promise<void> {
    try {
      await this.recordProductEvent.execute(command)
    } catch (error) {
      this.logger.error(
        `recordEvent(eventType="${command.eventType}", tenantId="${command.tenantId}") failed: ${String(error)}`,
        error instanceof Error ? error.stack : undefined,
      )
    }
  }
}
