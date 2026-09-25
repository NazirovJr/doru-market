// Σ savingsDiram по позициям заказа с совпадением medicineId+sessionId; без совпадения — 0, не ошибка.
import { Inject, Injectable } from '@nestjs/common'
import {
  PRODUCT_EVENTS_REPOSITORY,
  type ProductEventsRepositoryPort,
} from '../ports/product-events-repository.port.js'

export interface RealizedSavingsOrderItem {
  readonly medicineId: string
}

/** Объект-параметр `calculate` (C5, `max-params` ≤3) — `orderId` не участвует в запросе, только контекст. */
export interface RealizedSavingsCalculateInput {
  readonly orderId: string
  readonly orderItems: readonly RealizedSavingsOrderItem[]
  readonly tenantId: string
  readonly sessionId: string
}

const ZERO_DIRAM = 0n

@Injectable()
export class RealizedSavingsCalculator {
  public constructor(@Inject(PRODUCT_EVENTS_REPOSITORY) private readonly repository: ProductEventsRepositoryPort) {}

  public async calculate(input: RealizedSavingsCalculateInput): Promise<bigint> {
    const { orderItems, tenantId, sessionId } = input
    if (orderItems.length === 0 || sessionId.trim().length === 0) {
      return ZERO_DIRAM
    }
    const medicineIds = [...new Set(orderItems.map((item) => item.medicineId))]
    const matched = await this.repository.findMatchingSavingsEvents(tenantId, sessionId, medicineIds)
    return orderItems.reduce((sum, item) => sum + (matched.get(item.medicineId) ?? ZERO_DIRAM), ZERO_DIRAM)
  }
}
