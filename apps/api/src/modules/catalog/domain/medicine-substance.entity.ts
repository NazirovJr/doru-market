/**
 * Value entity `MedicineSubstance` (EP-04, DTJ-093). Связь `Medicine` ↔ `Substance` с
 * дозировкой конкретного вещества. Иммутабельная (`readonly`-поля) — после добавления в
 * `Medicine` нельзя изменить, только удалить целиком (через `Medicine`).
 *
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.3: примитивы запрещены в сигнатурах домена —
 * `strengthValue` это `number` (в БД `NUMERIC(10,4)`), `strengthUnit` это типизированный
 * enum `DosageUnit` из `packages/domain-kernel`.
 */
import { err, ok } from '@dorutj/domain-kernel'
import type { DosageUnit, Result } from '@dorutj/domain-kernel'
import { DomainError } from './errors/domain-error.js'

export class InvalidMedicineSubstanceError extends DomainError {
  public constructor(message: string) {
    super('INVALID_MEDICINE_SUBSTANCE', message)
  }
}

export class MedicineSubstance {
  private constructor(
    public readonly substanceId: string,
    public readonly strengthValue: number,
    public readonly strengthUnit: DosageUnit,
  ) {}

  public static create(
    substanceId: string,
    strengthValue: number,
    strengthUnit: DosageUnit,
  ): Result<MedicineSubstance, InvalidMedicineSubstanceError> {
    if (substanceId.length === 0) {
      return err(new InvalidMedicineSubstanceError('substanceId must be non-empty'))
    }
    if (!Number.isFinite(strengthValue) || strengthValue <= 0) {
      return err(new InvalidMedicineSubstanceError(`strengthValue must be > 0, got ${String(strengthValue)}`))
    }
    return ok(new MedicineSubstance(substanceId, strengthValue, strengthUnit))
  }
}
