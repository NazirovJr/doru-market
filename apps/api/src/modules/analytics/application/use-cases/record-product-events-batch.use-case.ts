// Батч-приём телеметрии: строит ProductEvent напрямую (не через AnalyticsFacade — та глотает
// любую ошибку под logger.error, стирая разницу между «известный невалидный элемент» и
// «инфраструктурный сбой»). Невалидный элемент — warn и пропуск, остальные вставляются одним insertBatch.
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { ValidationError } from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { ProductEvent } from '../../domain/product-event.entity.js'
import { PRODUCT_EVENTS_REPOSITORY, type ProductEventsRepositoryPort } from '../ports/product-events-repository.port.js'

export interface RecordProductEventsBatchItem {
  readonly eventType: string
  readonly sessionId: string
  readonly medicineId?: string | null
  readonly pharmacyId?: string | null
  readonly savingsDiram?: bigint | null
  readonly metadata?: Record<string, unknown>
}

export interface RecordProductEventsBatchCommand {
  readonly tenantId: string
  readonly userId: string | null // null — гость (SRS-ADM-067)
  readonly events: readonly RecordProductEventsBatchItem[]
}

@Injectable()
export class RecordProductEventsBatchUseCase {
  public constructor(
    @Inject(PRODUCT_EVENTS_REPOSITORY) private readonly repository: ProductEventsRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  public async execute(command: RecordProductEventsBatchCommand): Promise<void> {
    const now = this.clock.now()
    const events: ProductEvent[] = []
    for (const item of command.events) {
      const event = this.tryCreate(command, item, now)
      if (event !== null) {
        events.push(event)
      }
    }
    await this.repository.insertBatch(events)
  }

  private tryCreate(command: RecordProductEventsBatchCommand, item: RecordProductEventsBatchItem, now: Date): ProductEvent | null {
    try {
      return ProductEvent.create(
        {
          tenantId: command.tenantId,
          userId: command.userId,
          sessionId: item.sessionId,
          eventType: item.eventType,
          medicineId: item.medicineId ?? null,
          pharmacyId: item.pharmacyId ?? null,
          savingsDiram: item.savingsDiram ?? null,
          ...(item.metadata === undefined ? {} : { metadata: item.metadata }), // exactOptionalPropertyTypes
        },
        now,
      )
    } catch (error) {
      if (error instanceof ValidationError) {
        this.logger.warn(
          { tenantId: command.tenantId, eventType: item.eventType, reason: error.message },
          'analytics_events_batch_item_skipped',
        )
        return null
      }
      throw error
    }
  }
}
