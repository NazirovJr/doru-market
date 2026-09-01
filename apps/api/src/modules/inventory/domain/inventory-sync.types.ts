/**
 * Доменные типы синхронизаций (EP-05, DTJ-144, DTJ-148). Эти string-union
 * повторяют CHECK-инварианты в `0012_inventory_foundation.sql` (channel)
 * и расширенный набор значений FSM из `inventory-sync-batch.entity.ts`
 * (status, SRS-DOM-145..150).
 */
export type InventorySyncChannel = 'manual' | 'excel' | 'rest'

/** Статусы FSM (полный набор — в `inventory-sync-batch.entity.ts`). */
export type InventorySyncStatus =
  | 'queued'
  | 'processing'
  | 'completed_full_success'
  | 'completed_partial_success'
  | 'failed_validation'
