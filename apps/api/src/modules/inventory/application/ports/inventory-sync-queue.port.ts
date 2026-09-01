/**
 * Порт `InventorySyncQueuePort` (EP-05, DTJ-153, SRS-INV-030/031/032/034).
 *
 * BullMQ-очередь `inventory-sync-queue` для воркера `InventorySyncBatchProcessor`
 * (DTJ-155). Job НЕ несёт payload (SRS-INV-031) — воркер читает
 * `inventory_sync_raw_items` по `batchId`.
 *
 * **Важно (DTJ-153 §1):** контроллеры каналов (DTJ-157/161) НЕ вызывают
 * этот порт НАПРЯМУЮ — они публикуют `InventoryBatchQueuedEvent` в общий
 * `OutboxPort` (EP-01), и уже `OutboxRelayWorker` (DTJ-016 follow-up)
 * доставляет его подписчику, который вызывает `enqueue(...)`. Прямой
 * вызов из HTTP-хендлера нарушил бы транзакционную гарантию
 * (`commit БД → enqueue Redis` — окно потери job'а при падении
 * процесса).
 *
 * `jobId = batchId` (SRS-INV-032) — дедупликация при at-least-once
 * доставке outbox.
 */
import type { InventorySyncChannel } from '../../domain/inventory-sync.types.js'

export const INVENTORY_SYNC_QUEUE = Symbol.for('@dorutj/inventory/inventory-sync-queue')

export type InventorySyncSyncType = 'delta' | 'full'

/** Данные job'а, дословно по `22-module-inventory-sync-1c.md` строки 468-473. */
export interface InventorySyncJobData {
  readonly batchId: string
  readonly pharmacyId: string
  readonly channel: InventorySyncChannel
  readonly syncType: InventorySyncSyncType
}

/** Приоритеты (SRS-INV-034) — единая таблица, не цепочка if/else. */
export const INVENTORY_SYNC_JOB_PRIORITY = {
  /** `rest_api` + `delta` или `manual_entry` + `delta` */
  REST_OR_MANUAL_DELTA: 1,
  /** `excel_import` + `delta` */
  EXCEL_DELTA: 5,
  /** ЛЮБОЙ `syncType='full'` (даже если `manual_entry`/Excel) */
  ANY_FULL: 10,
} as const

/**
 * Резолвер приоритета — чистая функция (тестируется отдельно).
 * Покрывает ВСЕ комбинации `(channel, syncType)`, см. таблицу выше.
 * `syncType='full'` ПЕРЕБИВАЕТ channel-приоритет (не наследует
 * `REST_OR_MANUAL_DELTA`, тикет DTJ-153 §«Критерии» #4).
 */
export function resolveInventorySyncJobPriority(
  channel: InventorySyncChannel,
  syncType: InventorySyncSyncType,
): number {
  if (syncType === 'full') return INVENTORY_SYNC_JOB_PRIORITY.ANY_FULL
  if (channel === 'excel') return INVENTORY_SYNC_JOB_PRIORITY.EXCEL_DELTA
  return INVENTORY_SYNC_JOB_PRIORITY.REST_OR_MANUAL_DELTA
}

export interface InventorySyncQueuePort {
  /**
   * Постановка job'а в BullMQ-очередь `inventory-sync-queue`.
   * `jobId=batchId` (SRS-INV-032 — дедупликация). Retry — `5 attempts,
   * exponential 5s` (SRS-INV-035; параметры задаются здесь, не на
   * стороне worker'а).
   */
  enqueue(job: InventorySyncJobData): Promise<void>
}

/** Событие, которое публикует контроллер в `OutboxPort`. */
export interface InventoryBatchQueuedEvent {
  readonly eventType: 'inventory.sync_batch.queued'
  readonly batchId: string
  readonly pharmacyId: string
  readonly channel: InventorySyncChannel
  readonly syncType: InventorySyncSyncType
}
