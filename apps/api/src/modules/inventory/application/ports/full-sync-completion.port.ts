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
// `UnitOfWorkTx` — через публичный фасад модуля `auth` (D-27, `no-cross-module-deep-import`):
// inventory не имеет собственного UoW-порта, использует чужой через фасад (см. use case JSDoc).
import type { UnitOfWorkTx } from '@/modules/auth/index.js'

export const FULL_SYNC_COMPLETION = Symbol.for('@dorutj/inventory/full-sync-completion')

/** Параметры `zeroOutMissing` — объект-параметр (C5, `max-params` ≤3: 4 позиционных не влезали). */
export interface ZeroOutMissingInput {
  readonly pharmacyId: string
  readonly fullSyncSessionId: string
  /** Момент старта сессии (для `lastSyncedAt`-фильтра). */
  readonly fullSyncTimestamp: Date
  /**
   * (волна 6, self-deadlock пула соединений, тот же дефект, что чинили в checkout
   * DTJ-231/233): `IngestInventoryBatchWithMatchingUseCase.execute` вызывает этот метод
   * ВНУТРИ `uow.run(tx => ...)` — без `tx` метод просил бы у пула ВТОРОЕ соединение
   * поверх уже удержанного, при конкурентности ≥ размера пула тупик навсегда (см. JSDoc
   * use case'а).
   */
  readonly tx?: UnitOfWorkTx
}

export interface FullSyncCompletionPort {
  /** Обнулить остатки, не упомянутые в текущей full-sync сессии. */
  zeroOutMissing(input: ZeroOutMissingInput): Promise<{ readonly zeroedLots: number }>
}
