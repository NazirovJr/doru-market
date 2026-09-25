// Батч-приём телеметрии: строит ProductEvent напрямую (не через AnalyticsFacade — та глотает
// любую ошибку под logger.error, стирая разницу между «известный невалидный элемент» и
// «инфраструктурный сбой»). Невалидный элемент — warn и пропуск, остальные вставляются одним insertBatch.
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { ValidationError } from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { ProductEvent, isClientProductEventType } from '../../domain/product-event.entity.js'
import { PRODUCT_EVENTS_REPOSITORY, type ProductEventsRepositoryPort } from '../ports/product-events-repository.port.js'
import { ANALOG_SAVINGS_PORT, type AnalogSavingsPort } from '../ports/analog-savings.port.js'

export interface RecordProductEventsBatchItem {
  readonly eventType: string
  readonly sessionId: string
  readonly medicineId?: string | null
  readonly pharmacyId?: string | null
  // DTJ-385: препарат-референс для analog_shown/added_to_cart, только вход — не персистится отдельно.
  readonly referenceMedicineId?: string | null
  readonly savingsDiram?: bigint | null
  readonly metadata?: Record<string, unknown>
}

export interface RecordProductEventsBatchCommand {
  readonly tenantId: string
  readonly userId: string | null // null — гость (SRS-ADM-067)
  readonly events: readonly RecordProductEventsBatchItem[]
}

interface BatchItemContext {
  readonly command: RecordProductEventsBatchCommand
  readonly now: Date
  readonly savingsByPair: ReadonlyMap<string, bigint | null>
}

interface AnalogSavingsPair {
  readonly referenceMedicineId: string
  readonly analogMedicineId: string
  readonly pharmacyId: string | null
}

// DTJ-385: для этих типов savingsDiram всегда считает сервер, клиентское значение игнорируется.
const ANALOG_SAVINGS_EVENT_TYPES: ReadonlySet<string> = new Set(['analog_shown', 'added_to_cart'])

@Injectable()
export class RecordProductEventsBatchUseCase {
  // eslint-disable-next-line max-params -- NestJS DI: 4 порта в конструкторе, та же практика, что search-medicines.use-case.ts
  public constructor(
    @Inject(PRODUCT_EVENTS_REPOSITORY) private readonly repository: ProductEventsRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
    @Inject(ANALOG_SAVINGS_PORT) private readonly analogSavings: AnalogSavingsPort,
  ) {}

  public async execute(command: RecordProductEventsBatchCommand): Promise<void> {
    const ctx: BatchItemContext = {
      command,
      now: this.clock.now(),
      savingsByPair: await this.computeAnalogSavings(command),
    }
    const events: ProductEvent[] = []
    for (const item of command.events) {
      const event = this.tryCreate(item, ctx)
      if (event !== null) {
        events.push(event)
      }
    }
    await this.repository.insertBatch(events)
  }

  // Дедупликация пар (референс, аналог) внутри батча (АС3 DTJ-385) — порт вызывается один раз на уникальную пару.
  private async computeAnalogSavings(command: RecordProductEventsBatchCommand): Promise<ReadonlyMap<string, bigint | null>> {
    const pairs = new Map<string, AnalogSavingsPair>()
    for (const item of command.events) {
      if (!ANALOG_SAVINGS_EVENT_TYPES.has(item.eventType)) continue
      if (item.referenceMedicineId == null || item.medicineId == null) continue
      const pharmacyId = item.pharmacyId ?? null
      const key = buildAnalogSavingsPairKey(item.referenceMedicineId, item.medicineId, pharmacyId)
      if (!pairs.has(key)) {
        pairs.set(key, { referenceMedicineId: item.referenceMedicineId, analogMedicineId: item.medicineId, pharmacyId })
      }
    }
    const entries = [...pairs.entries()]
    const computed = await Promise.all(entries.map(([, pair]) => this.computePairSavings(command.tenantId, pair)))
    return new Map(entries.map(([key], index) => [key, computed[index] ?? null]))
  }

  private computePairSavings(tenantId: string, pair: AnalogSavingsPair): Promise<bigint | null> {
    return this.analogSavings.compute({
      tenantId,
      referenceMedicineId: pair.referenceMedicineId,
      analogMedicineId: pair.analogMedicineId,
      ...(pair.pharmacyId === null ? {} : { pharmacyId: pair.pharmacyId }),
    })
  }

  private tryCreate(item: RecordProductEventsBatchItem, ctx: BatchItemContext): ProductEvent | null {
    const { command, now } = ctx
    // order_placed от клиента — та же судьба, что неизвестный тип (не 400 на весь батч, АС3):
    // иначе бот пишет произвольный savingsDiram в накопительную метрику экономии (CTO-возврат).
    if (!isClientProductEventType(item.eventType)) {
      this.logger.warn(
        { tenantId: command.tenantId, eventType: item.eventType, reason: 'not a client-accepted event type' },
        'analytics_events_batch_item_skipped',
      )
      return null
    }
    try {
      return ProductEvent.create(
        {
          tenantId: command.tenantId,
          userId: command.userId,
          sessionId: item.sessionId,
          eventType: item.eventType,
          medicineId: item.medicineId ?? null,
          pharmacyId: item.pharmacyId ?? null,
          savingsDiram: this.resolveSavingsDiram(item, ctx.savingsByPair),
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

  private resolveSavingsDiram(item: RecordProductEventsBatchItem, savingsByPair: ReadonlyMap<string, bigint | null>): bigint | null {
    if (!ANALOG_SAVINGS_EVENT_TYPES.has(item.eventType)) {
      return item.savingsDiram ?? null
    }
    if (item.referenceMedicineId == null || item.medicineId == null) return null
    const key = buildAnalogSavingsPairKey(item.referenceMedicineId, item.medicineId, item.pharmacyId ?? null)
    return savingsByPair.get(key) ?? null
  }
}

function buildAnalogSavingsPairKey(referenceMedicineId: string, analogMedicineId: string, pharmacyId: string | null): string {
  return `${referenceMedicineId}|${analogMedicineId}|${pharmacyId ?? ''}`
}
