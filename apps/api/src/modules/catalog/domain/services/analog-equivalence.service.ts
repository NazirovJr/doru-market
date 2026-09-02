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
 *
 * ИСПРАВЛЕНО (D-07, аудит эквивалентности единиц): дозировка сравнивается через
 * `Dosage.isEquivalentTo()` (импорт `@dorutj/domain-kernel` — именно эта копия VO
 * используется в модуле `catalog`, см. `medicine.entity.ts`), а НЕ через `!==` по
 * сырым `strengthValue`/`strengthUnit`. `500 мг` и `0.5 г` — одна и та же дозировка
 * в разных единицах одного семейства (`mass`) и обязаны признаваться аналогами.
 */
import { Dosage, isOk } from '@dorutj/domain-kernel'
import type { Medicine } from '../medicine.entity.js'

export class AnalogEquivalenceService {
  /**
   * Финальное решение (SRS-CAT-031): препарат B — аналог A И ТОЛЬКО ЕСЛИ:
   * 1. Множество `substanceId` идентично (не подмножество/пересечение).
   * 2. `dosageForm.isEquivalentTo(...)` — точное совпадение класса (диагональ).
   * 3. Для каждого общего `substanceId` — ЭКВИВАЛЕНТНАЯ дозировка через
   *    `Dosage.isEquivalentTo()` (SRS-DOM-078, bigint-конвертация в микрограммы
   *    внутри семейства единиц: `500 мг` эквивалентно `0.5 г`, но НЕ `1 г` —
   *    `100 мг`).
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
      const aDosageResult = Dosage.create(aSubstance.strengthValue, aSubstance.strengthUnit)
      const bDosageResult = Dosage.create(bSubstance.strengthValue, bSubstance.strengthUnit)
      if (!isOk(aDosageResult) || !isOk(bDosageResult)) {
        // `MedicineSubstance.create` уже гарантирует `strengthValue > 0` и конечность
        // (`medicine-substance.entity.ts`), так что `Dosage.create` здесь не должен
        // падать. Если всё же падает — fail-safe: не считаем аналогом.
        return false
      }
      // Эквивалентность через `Dosage.isEquivalentTo()` (SRS-DOM-078): сравнение
      // внутри семейства единиц после конвертации в базовую единицу (bigint,
      // микрограммы для `mass`), а НЕ равенство сырых `strengthValue`/`strengthUnit`.
      // `500 мг` эквивалентно `0.5 г`; разные семейства (`mg` vs `ml`) — никогда.
      if (!aDosageResult.value.isEquivalentTo(bDosageResult.value)) {
        return false
      }
    }
    return true
  }
}
