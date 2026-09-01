import { err, ok, type Result } from '../common/result.js'
import { DosageParseError, InvalidDosageError } from './dosage.errors.js'
import { DosageUnit } from './dosage-unit.js'

/**
 * Семейства единиц дозировки (SRS-DOM-078, правка от 28.08.2026):
 *   - `mass` — `mg` / `mcg` / `g`, конвертируются между собой через `MASS_FAMILY_MULTIPLIERS`;
 *   - `volume` — только `ml` (одна единица в семействе, сравнение внутри себя);
 *   - `iu` — международные единицы (одна единица в семействе);
 *   - `percent` — проценты (одна единица в семействе);
 *   - `mgPerMl` — концентрация «мг/мл» (одна единица, своё семейство).
 * Между семействами конвертация запрещена (мг и мл несопоставимы — это инвариант,
 * а не особенность реализации).
 */
const MASS_FAMILY = 'mass'
const VOLUME_FAMILY = 'volume'
const IU_FAMILY = 'iu'
const PERCENT_FAMILY = 'percent'
const MG_PER_ML_FAMILY = 'mgPerMl'

const UNIT_FAMILY: Readonly<Record<DosageUnit, string>> = {
  [DosageUnit.mg]: MASS_FAMILY,
  [DosageUnit.mcg]: MASS_FAMILY,
  [DosageUnit.g]: MASS_FAMILY,
  [DosageUnit.ml]: VOLUME_FAMILY,
  [DosageUnit.iu]: IU_FAMILY,
  [DosageUnit.percent]: PERCENT_FAMILY,
  [DosageUnit.mgPerMl]: MG_PER_ML_FAMILY,
}

/**
 * Множитель перевода массы в микрограммы. `bigint` (целочисленно) — никаких float в
 * сравнении дозировок (SRS-DOM-078). `mg` (×1_000), `g` (×1_000_000), `mcg` (×1).
 */
const MASS_MULTIPLIER_MCG = 1n
const MASS_MULTIPLIER_MG = 1_000n
const MASS_MULTIPLIER_G = 1_000_000n
const MASS_FAMILY_MULTIPLIERS: Readonly<Record<string, bigint>> = {
  mcg: MASS_MULTIPLIER_MCG,
  mg: MASS_MULTIPLIER_MG,
  g: MASS_MULTIPLIER_G,
}

/** Число значащих цифр после запятой при переводе `number → bigint microgram`. */
const MICROS_DECIMAL_PLACES = 6
/** Множитель для bigint-представления `MICROS_DECIMAL_PLACES` цифр. */
const MICROS_SCALE = 1_000_000n
/** Множитель `100%` для перевода в проценты. */
const PERCENT_SCALE_BIGINT = 10_000n
const PERCENT_SCALE_NUMBER = 100

const STRICT_TOLERANCE_PCT = 0
const STRICT_TOLERANCE_DEFAULT = 0
const ZERO_BIGINT = 0n
const ZERO_NUMBER = 0
const ALLOWED_PARSER_UNITS = new Set<string>(Object.values(DosageUnit))

/**
 * Value Object `Dosage` (SRS-DOM-077/078). Неизменяемый (`readonly`-поля), сравнение
 * через `isEquivalentTo` (ТОЧНОЕ совпадение после конвертации в базовую единицу
 * семейства), парсинг строк — только в конструкторе `Dosage.parse()`.
 */
export class Dosage {
  private constructor(
    private readonly value: number,
    private readonly unit: DosageUnit,
  ) {}

  public static create(value: number, unit: DosageUnit): Result<Dosage, InvalidDosageError> {
    if (!Number.isFinite(value)) {
      return err(new InvalidDosageError(`value is not finite: ${String(value)}`))
    }
    if (value <= 0) {
      return err(new InvalidDosageError(`value must be > 0, got ${String(value)}`))
    }
    return ok(new Dosage(value, unit))
  }

  /**
   * Разбор строки вида `"500 мг"`, `"10 мг/мл"`, `"0.5 g"`, `"100 IU"`. Используется
   * сидом/импортом 1С; не домен-инвариант, вспомогательный парсер. Чистая функция.
   */
  public static parse(raw: string): Result<Dosage, DosageParseError> {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return err(new DosageParseError('empty input'))
    }
    const match = /^(-?\d+(?:[.,]\d+)?)\s*([^\s/]+(?:\/[^\s/]+)?)$/u.exec(trimmed)
    if (!match) {
      return err(new DosageParseError(`cannot parse dosage from: ${raw}`))
    }
    const numericRaw = match[1] ?? ''
    const unitRaw = (match[2] ?? '').toLowerCase()
    if (numericRaw === '' || unitRaw === '') {
      return err(new DosageParseError(`cannot parse dosage from: ${raw}`))
    }
    const normalized = unitRaw.replace(',', '.')
    const numeric = Number(numericRaw.replace(',', '.'))
    const unit = unitToEnum(normalized)
    if (unit === null) {
      return err(new DosageParseError(`unknown unit: ${unitRaw}`))
    }
    return Dosage.create(numeric, unit)
  }

  public getValue(): number {
    return this.value
  }

  public getUnit(): DosageUnit {
    return this.unit
  }

  /**
   * Эквивалентность ТОЛЬКО после конвертации в базовую единицу семейства
   * (SRS-DOM-078, `DOSAGE_EQUIVALENCE_TOLERANCE_PCT = 0`).
   *
   * Алгоритм (правка от 28.08.2026, волна 3.5):
   *   1. Семейства единиц должны совпадать — иначе конвертация запрещена
   *      (мг и мл несопоставимы по SRS-DOM-078).
   *   2. Для семейства `mass` (mg/mcg/g) — приводим обе дозировки к базовой
   *      единице `mcg` через `MASS_FAMILY_MULTIPLIERS` (целочисленно, bigint,
   *      без float) и сравниваем.
   *   3. Для остальных семейств (`volume`/`iu`/`percent`/`mgPerMl`) — в семействе
   *      ровно одна единица, сравнение сводится к точному совпадению чисел.
   */
  public isEquivalentTo(other: Dosage): boolean {
    if (UNIT_FAMILY[this.unit] !== UNIT_FAMILY[other.unit]) {
      return false
    }
    if (this.unit === other.unit) {
      return this.valuesMatchWithTolerance(this.value, other.value)
    }
    if (UNIT_FAMILY[this.unit] === MASS_FAMILY) {
      return this.massValuesEqualInMicrogram(other)
    }
    // Внутри `volume`/`iu`/`percent`/`mgPerMl` одна единица на семейство;
    // случай «разные единицы одного семейства» сюда не попадает (защита от
    // регрессии при добавлении новых единиц).
    return false
  }

  private massValuesEqualInMicrogram(other: Dosage): boolean {
    const multiplierA = MASS_FAMILY_MULTIPLIERS[this.unit]
    const multiplierB = MASS_FAMILY_MULTIPLIERS[other.unit]
    if (multiplierA === undefined || multiplierB === undefined) {
      return false
    }
    const aMicro = toBigIntMicro(this.value) * multiplierA
    const bMicro = toBigIntMicro(other.value) * multiplierB
    // Сейчас `STRICT_TOLERANCE_PCT = 0` — `if` всегда true; ветка «else» с толерантностью
    // оставлена намеренно как заготовка для будущей конфигурируемой толерантности (SRS-DOM-078
    // явно разрешает «0» как «строгое совпадение»). Не удалять dead-code, пока архитектор
    // не утвердит противоположное ADR.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- заготовка под ADR о конфигурируемой толерантности (SRS-DOM-078 явно разрешает «0» как «строгое совпадение»); ветка «else» с толерантностью мёртвая при `STRICT_TOLERANCE_PCT = 0`, но оставлена осознанно. Не удалять dead-code, пока архитектор не утвердит противоположное ADR.
    if (STRICT_TOLERANCE_PCT !== STRICT_TOLERANCE_DEFAULT) {
      const diff = aMicro > bMicro ? aMicro - bMicro : bMicro - aMicro
      const max = aMicro > bMicro ? aMicro : bMicro
      if (max === ZERO_BIGINT) {
        return true
      }
      const diffPct = Number((diff * PERCENT_SCALE_BIGINT) / max) / PERCENT_SCALE_NUMBER
      return diffPct <= STRICT_TOLERANCE_PCT
    }
    return aMicro === bMicro
  }

  private valuesMatchWithTolerance(a: number, b: number): boolean {
    // См. обоснование в `isEquivalentTo` — ветка с толерантностью мёртвая при
    // `STRICT_TOLERANCE_PCT = 0`, но оставлена как заготовка под ADR.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- см. обоснование в `isEquivalentTo` выше: ветка с толерантностью мёртвая при `STRICT_TOLERANCE_PCT = 0`, но оставлена как заготовка под ADR.
    if (STRICT_TOLERANCE_PCT !== STRICT_TOLERANCE_DEFAULT) {
      const diff = Math.abs(a - b)
      const max = Math.max(Math.abs(a), Math.abs(b))
      if (max === ZERO_NUMBER) {
        return true
      }
      return (diff / max) * PERCENT_SCALE_NUMBER <= STRICT_TOLERANCE_PCT
    }
    return a === b
  }
}

function toBigIntMicro(value: number): bigint {
  const fixed = value.toFixed(MICROS_DECIMAL_PLACES)
  const [intPart, fracPart = ''] = fixed.split('.')
  const intSafe = intPart ?? '0'
  const padded = (fracPart + '000000').slice(0, MICROS_DECIMAL_PLACES)
  return BigInt(intSafe) * MICROS_SCALE + BigInt(padded)
}

function unitToEnum(raw: string): DosageUnit | null {
  const normalized = raw.replace(/\s+/g, '')
  const candidates: readonly [string, DosageUnit][] = [
    ['мг', DosageUnit.mg],
    ['mg', DosageUnit.mg],
    ['мкг', DosageUnit.mcg],
    ['mcg', DosageUnit.mcg],
    ['µg', DosageUnit.mcg],
    ['г', DosageUnit.g],
    ['g', DosageUnit.g],
    ['мл', DosageUnit.ml],
    ['ml', DosageUnit.ml],
    ['ме', DosageUnit.iu],
    ['iu', DosageUnit.iu],
    ['%', DosageUnit.percent],
    ['percent', DosageUnit.percent],
    ['мг/мл', DosageUnit.mgPerMl],
    ['mg/ml', DosageUnit.mgPerMl],
  ]
  for (const [key, value] of candidates) {
    if (key === normalized && ALLOWED_PARSER_UNITS.has(value)) {
      return value
    }
  }
  return null
}
