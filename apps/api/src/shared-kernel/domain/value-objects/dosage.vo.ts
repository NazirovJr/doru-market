/**
 * `Dosage` Value Object (EP-01, DTJ-009, SRS-DOM-077/078) — дозировка
 * с разбором строки вида `"500 мг"`/`"10 мг/мл"` и конвертацией
 * массы (mg/mcg/g) ЦЕЛОЧИСЛЕННО через `bigint` (без `float`, C7).
 *
 * `isEquivalentTo()` — ТОЛЬКО внутри одного семейства единиц:
 *   - масса: `mg` ↔ `mcg` ↔ `g` (1 g = 1000 mg = 1_000_000 mcg);
 *   - объём: `ml` (изолированно);
 *   - активность: `iu` (изолированно);
 *   - процент: `percent` (изолированно);
 *   - концентрация: `mg_per_ml` (изолированно, не конвертируется в массу).
 *
 * Дефолтный допуск — `0` (SRS-DOM-078: «сравнение строгое, без допуска»).
 */
import { err, ok, type Result } from '@dorutj/domain-kernel'

const MCG_PER_MG = 1_000n
import { ErrorCode, ValidationError } from '@dorutj/contracts'

export type DosageUnit = 'mg' | 'mcg' | 'g' | 'ml' | 'iu' | 'percent' | 'mg_per_ml'

export type DosageFamily = 'mass' | 'volume' | 'activity' | 'percent' | 'concentration'

const MG_TO_MCG = 1_000n
const G_TO_MG = 1_000n
const G_TO_MCG = 1_000_000n

const UNIT_FAMILY: Readonly<Record<DosageUnit, DosageFamily>> = {
  mg: 'mass',
  mcg: 'mass',
  g: 'mass',
  ml: 'volume',
  iu: 'activity',
  percent: 'percent',
  mg_per_ml: 'concentration',
}

export class Dosage {
  private constructor(
    readonly value: bigint,
    readonly unit: DosageUnit,
  ) {}

  /**
   * Парсит строку вида `"500 мг"` / `"10 мг/мл"` / `"5%`. Допускает:
   *   - пробелы между числом и единицей;
   *   - русские обозначения (`мг`, `мкг`, `г`, `мл`, `МЕ`, `%`).
   * Невалидный формат → `ValidationError` (400 `VALIDATION_ERROR`).
   */
  static parse(raw: string): Result<Dosage, ValidationError> {
    const match = /^([0-9]+(?:[.,][0-9]+)?)\s*([^\s]+)$/u.exec(raw.trim())
    if (match === null) {
      return err(
        new ValidationError(`Invalid dosage format: "${raw}"`, { raw }, ErrorCode.VALIDATION_ERROR),
      )
    }
    const valueRaw = match[1]
    const unitRaw = match[2]
    if (valueRaw === undefined || unitRaw === undefined) {
      return err(
        new ValidationError(`Invalid dosage format: "${raw}"`, { raw }, ErrorCode.VALIDATION_ERROR),
      )
    }
    // bigint не принимает дробные — конвертируем в «наименьшую единицу» (mcg / mg_ml_единица).
    // Для простоты R1 принимаем только целые значения.
    if (!/^[0-9]+$/.test(valueRaw)) {
      return err(
        new ValidationError(`Dosage value must be a positive integer: "${valueRaw}"`, { raw }, ErrorCode.VALIDATION_ERROR),
      )
    }
    const unit = normalizeUnit(unitRaw)
    if (unit === null) {
      return err(
        new ValidationError(`Unknown dosage unit: "${unitRaw}"`, { raw, unitRaw }, ErrorCode.VALIDATION_ERROR),
      )
    }
    return ok(new Dosage(BigInt(valueRaw), unit))
  }

  /**
   * Строгое сравнение ТОЛЬКО внутри одного семейства единиц. Разные семейства
   * (`mg` vs `ml`) → `false` (не ошибка — это штатный случай разных категорий).
   */
  isEquivalentTo(other: Dosage): boolean {
    const familyThis = UNIT_FAMILY[this.unit]
    const familyOther = UNIT_FAMILY[other.unit]
    if (familyThis !== familyOther) {
      return false
    }
    if (familyThis === 'mass') {
      return toMicrograms(this) === toMicrograms(other)
    }
    // Остальные семейства — точное совпадение (нет конвертации).
    return this.value === other.value && this.unit === other.unit
  }
}

// Алиасы единиц (рус./лат.) → канонический `DosageUnit`. Вынесено из
// `switch` в таблицу: 14 веток `case` толкали cyclomatic complexity
// `normalizeUnit` далеко за порог, а сам разбор — чистый lookup, не ветвление.
const UNIT_ALIASES: Readonly<Record<string, DosageUnit>> = {
  мг: 'mg',
  mg: 'mg',
  мкг: 'mcg',
  mcg: 'mcg',
  µg: 'mcg',
  г: 'g',
  g: 'g',
  мл: 'ml',
  ml: 'ml',
  ме: 'iu',
  iu: 'iu',
  '%': 'percent',
  percent: 'percent',
  'мг/мл': 'mg_per_ml',
  'mg/ml': 'mg_per_ml',
  'мг\\мл': 'mg_per_ml',
  'mg\\ml': 'mg_per_ml',
}

function normalizeUnit(raw: string): DosageUnit | null {
  const lower = raw.toLowerCase().replace(/ё/g, 'е')
  return UNIT_ALIASES[lower] ?? null
}

function toMicrograms(d: Dosage): bigint {
  switch (d.unit) {
    case 'mg':
      return d.value * MCG_PER_MG // 1 mg = 1000 mcg
    case 'mcg':
      return d.value
    case 'g':
      return d.value * G_TO_MCG // 1 g = 1_000_000_000 mcg
    default:
      // Не должно вызываться для не-mass.
      throw new Error(`internal: toMicrograms called for unit ${d.unit}`)
  }
}

// Константы экспортируются для тестов.
export { MG_TO_MCG, G_TO_MG, G_TO_MCG, UNIT_FAMILY }
