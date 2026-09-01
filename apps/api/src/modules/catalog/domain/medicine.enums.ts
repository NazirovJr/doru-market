/**
 * Enum'ы модуля `catalog` (EP-04). Значения совпадают с `dosage_form_class` и
 * `control_category` в `11-database-schema.md` (SRS-DOM-079, D-08). Хранятся в
 * `domain/` потому, что `Medicine` ссылается на них в инвариантах.
 */
/* eslint-disable @typescript-eslint/naming-convention -- Значения enum'ов должны совпадать с `dosage_form_class` / `control_category` в БД (11-database-schema.md, SRS-CAT-079). */
export enum DosageFormClass {
  tablet = 'tablet',
  capsule = 'capsule',
  syrup = 'syrup',
  injection = 'injection',
  ointment = 'ointment',
  drops = 'drops',
  inhaler = 'inhaler',
  suppository = 'suppository',
  other = 'other',
}

/**
 * Категория контроля оборота (D-08, SRS-DOM-014/015/157). `psychotropic`/`narcotic`
 * ЗАПРЕЩЕНЫ к дистанционной продаже на уровне домена (инвариант `Medicine`), `potent`
 * требует `isPrescriptionRequired = true` (SRS-DOM-015). Смена `potent`/`psychotropic`/
 * `narcotic` идёт ТОЛЬКО через `medicine.proposeControlCategory(...)` →
 * `NewControlCategoryCandidateEvent` → модерация (НЕ прямой мутацией).
 */
/* eslint-disable @typescript-eslint/naming-convention -- см. обоснование выше для DosageFormClass. `prescriptionOnly` хранится как `prescription_only` в БД. */
export enum ControlCategory {
  none = 'none',
  prescriptionOnly = 'prescription_only',
  potent = 'potent',
  psychotropic = 'psychotropic',
  narcotic = 'narcotic',
}

export const CONTROL_CATEGORIES_REQUIRING_MODERATION: ReadonlySet<ControlCategory> = new Set([
  ControlCategory.potent,
  ControlCategory.psychotropic,
  ControlCategory.narcotic,
])

export const CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE: ReadonlySet<ControlCategory> = new Set([
  ControlCategory.psychotropic,
  ControlCategory.narcotic,
])
