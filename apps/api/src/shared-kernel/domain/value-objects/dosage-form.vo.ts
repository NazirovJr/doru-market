/**
 * `DosageForm` Value Object (EP-01, DTJ-009, SRS-DOM-079) — укрупнённые
 * классы формы выпуска для строгого сравнения эквивалентности.
 *
 * Сравнение ТОЧНОЕ — `tablet` ≠ `capsule` даже для одного МНН. Это
 * сознательное упрощение R1: для фармацевта форма выпуска существенна
 * (показания могут различаться — капсула vs таблетка с модифицированным
 * высвобождением). R3 — расширение через иерархию форм.
 */
import { err, ok, type Result } from '@dorutj/domain-kernel'
import { ErrorCode, ValidationError } from '@dorutj/contracts'

export type DosageFormClass = 'tablet' | 'capsule' | 'syrup' | 'injection' | 'ointment' | 'drops' | 'inhaler' | 'suppository' | 'other'

const FORM_NORMALIZATION: Readonly<Record<string, DosageFormClass>> = {
  таблетка: 'tablet',
  таб: 'tablet',
  tablet: 'tablet',
  tab: 'tablet',
  капсула: 'capsule',
  капс: 'capsule',
  caps: 'capsule',
  capsule: 'capsule',
  сироп: 'syrup',
  syrup: 'syrup',
  инъекция: 'injection',
  раствор: 'injection',
  injection: 'injection',
  solution: 'injection',
  мазь: 'ointment',
  крем: 'ointment',
  ointment: 'ointment',
  cream: 'ointment',
  капли: 'drops',
  drops: 'drops',
  ингалятор: 'inhaler',
  inhaler: 'inhaler',
  свеча: 'suppository',
  суппозиторий: 'suppository',
  suppository: 'suppository',
}

export class DosageForm {
  private constructor(readonly form: DosageFormClass) {}

  static parse(raw: string): Result<DosageForm, ValidationError> {
    const key = raw.trim().toLowerCase()
    if (key.length === 0) {
      return err(
        new ValidationError('Dosage form is required', { raw }, ErrorCode.VALIDATION_ERROR),
      )
    }
    const normalized = FORM_NORMALIZATION[key] ?? 'other'
    return ok(new DosageForm(normalized))
  }

  isEquivalentTo(other: DosageForm): boolean {
    return this.form === other.form
  }
}
