/**
 * Локальные порты `apps/worker` для DTJ-155 — failed-handler.
 *
 * ЗЕРКАЛО API-портов `apps/api/src/modules/inventory/application/ports/`.
 * В R2 — вынести в `packages/contracts/` и переиспользовать (TODO
 * отмечен в DTJ-155 §«Риски и подводные камни»). Здесь — минимальная
 * поверхность, достаточная для failed-handler.
 */

/**
 * Минимальный контракт репозитория батчей. В API-реализации —
 * `InventorySyncBatchRepository` (DTJ-148/154). Здесь — только
 * методы, которые нужны handler'у: `findById` + `save`.
 */
export interface InventorySyncBatchRepositoryPort {
  findById(id: string): Promise<InventorySyncBatchSnapshot | null>
  save(batch: InventorySyncBatchSnapshot): Promise<void>
  appendError(input: {
    batchId: string
    rowIndex: number | null
    errorCode: string
    errorDetail: string
  }): Promise<void>
}

/** Снэпшот батча, достаточный для handler'а. */
export interface InventorySyncBatchSnapshot {
  readonly id: string
  readonly pharmacyId: string
  readonly status: InventorySyncStatus
  readonly syncType: 'full' | 'delta'
}

/** Множество статусов FSM (тикет DTJ-144). */
export type InventorySyncStatus =
  | 'queued'
  | 'processing'
  | 'completed_full_success'
  | 'completed_partial_success'
  | 'failed_validation'

/** Минимальный outbox-порт: только алерт-событие. */
export interface InventoryOutboxPort {
  appendProcessingFailedAlert(event: ProcessingFailedAlertEvent): void
}

/** Событие «батч не прошёл валидацию из-за инфраструктурного сбоя» (SRS-INV-035). */
export interface ProcessingFailedAlertEvent {
  readonly eventType: 'inventory.sync_batch.processing_failed'
  readonly batchId: string
  readonly pharmacyId: string
  readonly attemptsMade: number
  readonly lastErrorCode: string
}

/**
 * Минимальный порт часов (EP-01: замена `Date.now()` в domain).
 * Здесь объявлен локально для изоляции воркера от API/shared-kernel —
 * в R2 будет вынесен в `packages/contracts` (см. DTJ-155 §«Риски»).
 */
export interface ClockPort {
  now(): Date
}
