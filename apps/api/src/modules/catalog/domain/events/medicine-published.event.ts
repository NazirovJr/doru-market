/** SRS-DOM-013: публикуется при `Medicine.publish()`. Кладётся в outbox use case'ом. */
export interface MedicinePublishedEvent {
  readonly medicineId: string
  readonly publishedAt: string
}
