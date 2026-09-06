/**
 * Порт `CatalogMatchQueueReadPort` (EP-05, DTJ-163, SRS-INV-046) — узкий READ-ONLY доступ к
 * `catalog_match_queue`, тот же принцип, что DTJ-149 (доступ на чтение к чужой таблице через
 * явный узкий контракт, НЕ полноценное владение): таблица целиком принадлежит будущему
 * `moderation`-эпику (см. JSDoc `db/schema/catalog-match-queue.ts`), `inventory` читает
 * ТОЛЬКО агрегированное число ожидающих записей для отчёта кабинета аптеки — без доступа
 * к содержимому очереди (аптека не видит саму очередь модерации, SRS-INV-046).
 */
export const CATALOG_MATCH_QUEUE_READ = Symbol.for('@dorutj/inventory/catalog-match-queue-read')

export interface CatalogMatchQueueReadPort {
  /**
   * `COUNT(*) FROM catalog_match_queue WHERE pharmacy_id=:id AND status='pending'`.
   * `'pending'` — реальное значение `CatalogMatchQueueStatus` (см. схему) — тикет DTJ-163
   * упоминает `'pending_review'` в тексте, это НЕ значение, реально хранимое в колонке
   * (сверено со схемой), применяется тот же приём разрешения расхождения, что
   * `channel`/`status` в `sync-batches.schema.ts` (домен — источник истины).
   */
  countPending(pharmacyId: string): Promise<number>
}
