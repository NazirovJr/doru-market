/**
 * `AnalogEquivalenceService` (EP-07, DTJ-099). АВТОРИТЕТНОЕ, единственное место в
 * кодовой базе, где принимается финальное решение «B является аналогом A».
 * SQL-предфильтр (DTJ-100) лишь сужает выборку, окончательное решение — здесь.
 *
 * Чистая функция, ноль I/O (`02` §2.6). Юнит-тестируется без БД, порог покрытия
 * `domain/` ≥90% (`02` §6).
 *
 * ВАЖНО (SRS-CAT-033): диагональная матрица совместимости форм — ДИЗАЙН-РЕШЕНИЕ,
 * смягчение требует ADR на имя архитектора. Правка этого файла в обход ADR —
 * блокирующее замечание ревью.
 *
 * ВАЖНО (SRS-CAT-035, TC-CAT-010): суммарная/кратностная эквивалентность
 * (`500мг×2 ≟ 1000мг×1`) НЕ реализуется намеренно — домен не имеет понятия
 * «количество единиц в приёме», это относится к посологии, не к `Dosage` товара.
 */
import type { Medicine } from '../medicine.entity.js'

export class AnalogEquivalenceService {
  /**
   * Финальное решение (SRS-CAT-031): препарат B — аналог A И ТОЛЬКО ЕСЛИ:
   * 1. Множество `substanceId` идентично (не подмножество/пересечение).
   * 2. `dosageForm.isEquivalentTo(...)` — точное совпадение класса (диагональ).
   * 3. Для каждого общего `substanceId` — точное совпадение дозировки через
   *    `Dosage.isEquivalentTo()` (SRS-DOM-078, bigint-конвертация в микрограммы).
   * 4. Сравнение по строке `inn_name` ЗАПРЕЩЕНО как достаточное условие (SRS-DOM-017).
   */
  public isAnalog(a: Medicine, b: Medicine): boolean {
    if (a.getId() === b.getId()) {
      return false
    }
    if (!this.hasIdenticalSubstanceSet(a, b)) {
      return false
    }
    if (!a.getDosageForm().isEquivalentTo(b.getDosageForm())) {
      return false
    }
    return this.hasEquivalentStrengthForEverySubstance(a, b)
  }

  private hasIdenticalSubstanceSet(a: Medicine, b: Medicine): boolean {
    const aIds = a.getSubstances().map((s) => s.substanceId).sort()
    const bIds = b.getSubstances().map((s) => s.substanceId).sort()
    if (aIds.length !== bIds.length) {
      return false
    }
    for (let i = 0; i < aIds.length; i += 1) {
      if (aIds[i] !== bIds[i]) {
        return false
      }
    }
    return true
  }

  private hasEquivalentStrengthForEverySubstance(a: Medicine, b: Medicine): boolean {
    const aById = new Map(a.getSubstances().map((s) => [s.substanceId, s]))
    const bById = new Map(b.getSubstances().map((s) => [s.substanceId, s]))
    for (const [substanceId, aSubstance] of aById) {
      const bSubstance = bById.get(substanceId)
      if (!bSubstance) {
        return false
      }
      if (aSubstance.strengthUnit !== bSubstance.strengthUnit) {
        // Разные семейства единиц — НЕ эквивалентны, даже при числовом совпадении
        // (SRS-DOM-078, TC-CAT-012).
        return false
      }
      // Точное совпадение значения после конвертации внутри одной единицы
      // (DOSAGE_EQUIVALENCE_TOLERANCE_PCT = 0, SRS-DOM-078).
      if (aSubstance.strengthValue !== bSubstance.strengthValue) {
        return false
      }
    }
    return true
  }
}
