import type { ProductEvent } from '../../domain/product-event.entity.js'

export const PRODUCT_EVENTS_REPOSITORY = Symbol.for('@dorutj/analytics/product-events-repository')

export interface ProductEventsRepositoryPort {
  insert(event: ProductEvent): Promise<void>
  // Для батчевого приёма клиентской телеметрии (следующий тикет эпика).
  insertBatch(events: readonly ProductEvent[]): Promise<void>
}
