import { DomainError } from './domain-error.js'

/**
 * SRS-DOM-015: `controlCategory ∈ {potent, psychotropic, narcotic}` требует
 * `isPrescriptionRequired = true`. Нарушение в конструкторе `Medicine.create()`
 * или в `applyModeratedControlCategory()` — `InvalidMedicineStateError`.
 */
export class InvalidMedicineStateError extends DomainError {
  public constructor(message: string) {
    super('INVALID_MEDICINE_STATE', message)
  }
}
