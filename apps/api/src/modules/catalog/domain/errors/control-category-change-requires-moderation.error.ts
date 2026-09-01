import { DomainError } from './domain-error.js'

/**
 * SRS-DOM-014, D-08: смена `controlCategory` всегда идёт через
 * `medicine.proposeControlCategory()` → модерация → `applyModeratedControlCategory()`.
 * Прямая мутация в обход этого пути запрещена; попытка — `ControlCategoryChangeRequiresModerationError`.
 */
export class ControlCategoryChangeRequiresModerationError extends DomainError {
  public constructor(message: string) {
    super('CONTROL_CATEGORY_CHANGE_REQUIRES_MODERATION', message)
  }
}
