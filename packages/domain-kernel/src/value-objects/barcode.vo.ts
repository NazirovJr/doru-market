import { DomainError } from './dosage.errors.js'

/** Внутренний префикс GS1 — `restricted circulation number range` (D-06, SRS-DOM-075). */
const INTERNAL_PREFIX_DIGIT = '2'
/** Длина EAN-13 (SRS-DOM-074). */
const EAN_13_LENGTH = 13
/** Индекс контрольной цифры в EAN-13 (последняя из 13). */
const CONTROL_DIGIT_INDEX = EAN_13_LENGTH - 1
/**
 * Множитель для цифр на нечётных позициях (считая справа от контрольной, по стандарту GS1).
 * Используется в формуле взвешенной суммы EAN-13.
 */
const EAN_13_ODD_POS_MULTIPLIER = 3
/** Модуль для операции mod-10 (стандартная контрольная сумма EAN-13). */
const EAN_13_MODULUS = 10
const EAN_13_DIGITS_REGEX = /^\d{13}$/u

export class InvalidBarcodeError extends DomainError {
  public constructor(message: string) {
    super('INVALID_BARCODE', message)
  }
}

export type BarcodeFormat = 'ean13' | 'non_ean13'

/**
 * Value Object штрихкода (D-06, SRS-DOM-016, SRS-DOM-074..076). `parse()` НЕ бросает
 * исключение на «неожиданный» пользовательский ввод — строка сохраняется с
 * `format = 'non_ean13'`, composite-матчинг просто игнорирует её как первичный ключ
 * (SRS-DOM-076). Контрольная цифра EAN-13 проверяется по стандартному алгоритму GS1.
 */
export class Barcode {
  private constructor(
    private readonly rawValue: string,
    private readonly format: BarcodeFormat,
    private readonly isEan13Valid: boolean,
  ) {}

  public static parse(raw: string): Barcode {
    const trimmed = raw.trim()
    if (EAN_13_DIGITS_REGEX.test(trimmed)) {
      const isValid = Barcode.checkEan13Checksum(trimmed)
      return new Barcode(trimmed, 'ean13', isValid)
    }
    return new Barcode(trimmed, 'non_ean13', false)
  }

  public getRawValue(): string {
    return this.rawValue
  }

  public getFormat(): BarcodeFormat {
    return this.format
  }

  public isValidEan13(): boolean {
    return this.format === 'ean13' && this.isEan13Valid
  }

  /** Внутренний префикс `'2'` (D-06, SRS-DOM-075): НЕ используется как глобальный ключ. */
  public isInternalPrefix(): boolean {
    return this.rawValue.startsWith(INTERNAL_PREFIX_DIGIT)
  }

  /**
   * Допустимо для использования как ГЛОБАЛЬНЫЙ ключ матчинга между аптеками (D-06):
   * валидный EAN-13 И не внутренний префикс.
   */
  public isGloballyIdentifiable(): boolean {
    return this.isValidEan13() && !this.isInternalPrefix()
  }

  /**
   * Контрольная цифра EAN-13: `S = Σ(нечётные × 1) + 3 × Σ(чётные × 1)` для первых 12,
   * контрольная = `(10 - S mod 10) mod 10` (SRS-DOM-074, GS1 General Specifications).
   */
  private static checkEan13Checksum(value: string): boolean {
    const digits: number[] = []
    for (let i = 0; i < EAN_13_LENGTH; i += 1) {
      const ch = value.charAt(i)
      if (ch < '0' || ch > '9') {
        return false
      }
      digits.push(Number(ch))
    }
    let sumOdd = 0
    let sumEven = 0
    for (let i = 0; i < EAN_13_LENGTH - 1; i += 1) {
      const digit = digits[i] ?? 0
      if (i % 2 === 0) {
        sumOdd += digit
      } else {
        sumEven += digit
      }
    }
    const control = digits[CONTROL_DIGIT_INDEX] ?? 0
    const s = sumOdd + EAN_13_ODD_POS_MULTIPLIER * sumEven
    const expected = (EAN_13_MODULUS - (s % EAN_13_MODULUS)) % EAN_13_MODULUS
    return control === expected
  }
}
