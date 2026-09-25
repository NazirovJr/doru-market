import type { ProductEvent } from '../../domain/product-event.entity.js'

export const PRODUCT_EVENTS_REPOSITORY = Symbol.for('@dorutj/analytics/product-events-repository')

/** [start, end) — верхняя граница исключена, тот же приём, что period-фильтры остальных модулей. */
export interface AnalyticsPeriodRange {
  readonly start: Date
  readonly end: Date
}

/** `weekLabel` — ISO-дата (`YYYY-MM-DD`) начала недели, форматирование в подпись — забота фронта (`packages/i18n`). */
export interface WeeklyRealizedSavingsPoint {
  readonly weekLabel: string
  readonly realizedSavingsDiram: bigint
}

export interface ProductEventsRepositoryPort {
  insert(event: ProductEvent): Promise<void>
  // Для батчевого приёма клиентской телеметрии (следующий тикет эпика).
  insertBatch(events: readonly ProductEvent[]): Promise<void>
  // Последнее savingsDiram каждого medicineId из analog_shown/added_to_cart той же sessionId; без совпадения — ключа нет.
  findMatchingSavingsEvents(
    tenantId: string,
    sessionId: string,
    medicineIds: readonly string[],
  ): Promise<ReadonlyMap<string, bigint>>
  // DTJ-381 — воронка: счётчик по каждому eventType за период, 0 для типов без событий (не отсутствующий ключ).
  countByEventType(
    tenantId: string,
    period: AnalyticsPeriodRange,
    eventTypes: readonly string[],
  ): Promise<Readonly<Record<string, number>>>
  // DTJ-381 — Σ savingsDiram по eventType за период, 0n при отсутствии строк (не NULL).
  sumSavingsByEventType(tenantId: string, period: AnalyticsPeriodRange, eventType: string): Promise<bigint>
  // DTJ-381 — 7 недель, последняя оканчивается неделей, содержащей конец `period` (включая пустые недели).
  getWeeklyRealizedSavingsTrend(
    tenantId: string,
    period: AnalyticsPeriodRange,
  ): Promise<readonly WeeklyRealizedSavingsPoint[]>
}
