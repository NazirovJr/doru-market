/**
 * Порт `InventoryOutboxPort` (EP-05, DTJ-147, SRS-DOM-151).
 *
 * Узкий порт для публикации доменного события `UnmatchedInventoryRowEvent`
 * В ТОЙ ЖЕ единице работы (`unitOfWork`), что запись
 * `inventory_sync_errors` (DTJ-148, `IngestInventoryBatchUseCase`).
 * Гарантия: `append()` НЕ открывает собственную транзакцию (SRS-DOM-152:
 * outbox-паттерн реализован EP-01, этот тикет лишь формирует событие и
 * вызывает существующий механизм, не переизобретает его).
 *
 * **Координация с EP-01:** если общий `OutboxPort` EP-01 уже покрывает
 * сигнатуру `append(eventType, aggregateId, payload)` (см. тикет DTJ-147
 * §«Риски»), этот порт устаревает и должен быть удалён, а
 * `CompositeInventoryMatcherService` использует общий `OutboxPort` напрямую.
 */
export const INVENTORY_OUTBOX = Symbol.for('@dorutj/inventory/inventory-outbox')

/**
 * Доменное событие «строка синхронизации остатков не сматчена» — для
 * модератора и для последующей диагностики. Потребитель — `moderation`
 * модуль (через `catalog_match_queue`).
 */
export interface UnmatchedInventoryRowEvent {
  readonly eventType: 'inventory.row.unmatched'
  readonly pharmacyId: string
  /** Сырые данные строки — для отображения модератору. */
  readonly rawRowPayload: {
    readonly internalSku: string
    readonly rawBarcode: string | null
    readonly rawTradeName: string
    readonly rawDosageForm: string | null
    readonly rawDosageStrength: string | null
    readonly rawManufacturerName: string | null
  }
  /** `'no_candidate'` (нет кандидатов с score ≥ 0.35) или `'ambiguous'` (топ-1 и топ-2 слишком близки). */
  readonly reason: 'no_candidate' | 'ambiguous'
}

/**
 * Доменное событие «full-sync сессия зависла» (DTJ-152, SRS-INV-061).
 * Cron-watchdog публикует ровно ОДИН раз на сессию; повторный прогон
 * cron дедуплицирует через `hasStuckAlert`.
 */
export interface FullSyncSessionStuckEvent {
  readonly eventType: 'inventory.full_sync_session.stuck'
  readonly fullSyncSessionId: string
  readonly pharmacyId: string
  /** Момент получения ПОСЛЕДНЕЙ страницы сессии (не начала). */
  readonly lastPageReceivedAt: Date
}

/**
 * Доменное событие «батч синхронизации принят в очередь» (DTJ-157).
 * `OutboxRelayWorker` (DTJ-016 follow-up) доставляет это в
 * `BullmqInventorySyncQueueAdapter.enqueue(...)` (DTJ-153).
 */
export interface InventoryBatchQueuedEvent {
  readonly eventType: 'inventory.sync_batch.queued'
  readonly batchId: string
  readonly pharmacyId: string
  readonly channel: 'rest' | 'excel' | 'manual'
  readonly syncType: 'delta' | 'full'
}

export interface InventoryOutboxPort {
  /**
   * Добавить событие в outbox. БЕЗ `commit` — вызывающий use case
   * (DTJ-148) сам управляет транзакцией.
   */
  append(event: UnmatchedInventoryRowEvent): void

  /**
   * Событие «full-sync сессия зависла» (DTJ-152). Cron-watchdog
   * публикует ОДИН раз на сессию; дедупликация — через `hasStuckAlert`.
   */
  appendStuckSession(event: FullSyncSessionStuckEvent): void

  /**
   * Событие «батч поставлен в очередь» (DTJ-157). Контроллер канала
   * публикует; `OutboxRelayWorker` (DTJ-016) доставляет в
   * `BullmqInventorySyncQueueAdapter` (DTJ-153) для постановки BullMQ-job.
   */
  appendBatchQueued(event: InventoryBatchQueuedEvent): void

  /**
   * Дедупликация watchdog'а (DTJ-152, критерий 4): возвращает `true`,
   * если для `(fullSyncSessionId, eventType='inventory.full_sync_session.stuck')`
   * уже есть событие за последние `withinMinutes` минут.
   * Drizzle-реализация запрашивает таблицу `outbox` напрямую; InMemory —
   * фильтрует накопленные `events`.
   */
  hasStuckAlert(fullSyncSessionId: string, withinMinutes: number): Promise<boolean>
}
