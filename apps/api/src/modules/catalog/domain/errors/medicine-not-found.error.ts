import { DomainError } from './domain-error.js'

/**
 * `MedicineNotFoundError` (DTJ-095). Бросается, когда `Medicine` не найдена по `id`
 * ИЛИ найдена, но `isPublished = false` ИЛИ `controlCategory ∈ {psychotropic, narcotic}`.
 * Снаружи (HTTP) все три случая мапятся в `404 NOT_FOUND` — НЕ в `422`, существование
 * запрещённой к обороту записи не подтверждается постороннему (SRS-CAT-006).
 */
export class MedicineNotFoundError extends DomainError {
  public constructor(message: string) {
    super('MEDICINE_NOT_FOUND', message)
  }
}
