/**
 * SRS-DOM-014, D-08: публикуется при `medicine.proposeControlCategory()`. Потребляется
 * `moderation`-модулем (вне scope EP-04) для создания записи в `catalog_match_queue`
 * или эквивалентной очереди модерации.
 */
export interface NewControlCategoryCandidateEvent {
  readonly medicineId: string
  readonly proposedCategory: string
  readonly actorId: string
  readonly proposedAt: string
}
