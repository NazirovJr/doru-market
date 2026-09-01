import { err, ok, type Result } from '../common/result.js'
import { DomainError } from './dosage.errors.js'

/**
 * Укрупнённый класс лекарственной формы (значения совпадают с `dosage_form_class` в
 * `11-database-schema.md`, SRS-DOM-079). Используется для сравнения форм выпуска в
 * аналогах: эквивалентность — ТОЛЬКО диагональная матрица, без матрицы совместимости
 * (`20-module-catalog-search.md` §6.2, SRS-CAT-032/033).
 *
 * ВАЖНО: смягчение диагональной матрицы (например, `tablet ↔ capsule`) — НЕ допускается
 * правкой этого файла без отдельного ADR на имя архитектора (`03-ARCHITECT-DECISIONS.md`,
 * преамбула). Дизайн-решение зафиксировано в SRS-CAT-033.
 */
/* eslint-disable @typescript-eslint/naming-convention -- Enum-значения совпадают с `dosage_form_class` в БД (11-database-schema.md, SRS-DOM-079). Менять формат — сломает строковые сравнения `seed-данных`, миграций и API-контракта. */
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

export class InvalidDosageFormError extends DomainError {
  public constructor(message: string) {
    super('INVALID_DOSAGE_FORM', message)
  }
}

export class DosageForm {
  private constructor(private readonly formClass: DosageFormClass) {}

  public static create(formClass: DosageFormClass): Result<DosageForm, InvalidDosageFormError> {
    return ok(new DosageForm(formClass))
  }

  public static fromString(raw: string): Result<DosageForm, InvalidDosageFormError> {
    if (!(raw in DosageFormClass)) {
      return err(new InvalidDosageFormError(`unknown dosage form class: ${raw}`))
    }
    return ok(new DosageForm(raw as DosageFormClass))
  }

  public getFormClass(): DosageFormClass {
    return this.formClass
  }

  /**
   * Диагональное сравнение (SRS-DOM-079, SRS-CAT-032/033): форма эквивалентна ТОЛЬКО
   * самой себе. `tablet` ≠ `capsule` намеренно (биодоступность, фармакологический
   * профиль), `syrup` ≠ `injection` (путь введения). Смягчение требует ADR.
   */
  public isEquivalentTo(other: DosageForm): boolean {
    return this.formClass === other.formClass
  }
}
