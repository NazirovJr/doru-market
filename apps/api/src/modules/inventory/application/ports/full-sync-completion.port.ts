/**
 * Порт `FullSyncCompletionPort` (EP-05, DTJ-148/151, SRS-INV-027/041).
 *
 * Вызывается `IngestInventoryBatchWithMatchingUseCase` (DTJ-148) для
 * full-синхронизации на ПОСЛЕДНЕЙ странице (`isLastPage && syncType=full`):
 * «обнуление отсутствующих позиций» — если лот был в `pharmacy_inventory`,
 * но НЕ пришёл в текущей full-сессии, его `quantity` обнуляется
 * (SRS-INV-041).
 *
 * Реализация — DTJ-151/DTJ-154 (set-based `UPDATE pharmacy_inventory SET
 * quantity=0 WHERE pharmacy_id=$1 AND NOT EXISTS (... touched in session)`).
 * Этот тикет только ОБЪЯВЛЯЕТ интерфейс порта; use case тестируется с
 * моком, не зависит от наличия реализации.
 */
export const FULL_SYNC_COMPLETION = Symbol.for('@dorutj/inventory/full-sync-completion')

export interface FullSyncCompletionPort {
  /**
   * Обнулить остатки, не упомянутые в текущей full-sync сессии.
   *
   * @param pharmacyId UUID аптеки
   * @param fullSyncSessionId UUID сессии (для проверки, какие batch'и относятся к сессии)
   * @param fullSyncTimestamp момент старта сессии (для `lastSyncedAt`-фильтра)
   */
  zeroOutMissing(
    pharmacyId: string,
    fullSyncSessionId: string,
    fullSyncTimestamp: Date,
  ): Promise<{ readonly zeroedLots: number }>
}
