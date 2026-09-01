/**
 * `Barcode` Value Object (EP-01, DTJ-009, SRS-DOM-074..076) — обёртка для
 * штрихкодов с проверкой EAN-13 (контрольная цифра GS1) + определением
 * внутреннего префикса `2` (D-06).
 *
 * **ВАЖНО (SRS-DOM-074):** в отличие от прочих `parse()`-методов VO,
 * `Barcode.parse()` НЕ бросает исключение. Невалидный штрихкод — это
 * штатный кейс (ручное сканирование с ошибкой, фотография с артефактами);
 * `isValidEan13()` сообщает результат. `rawValue` всегда сохраняется
 * для аудита.
 *
 * Префикс `2` (D-06) — внутренний код продавца. НЕ используется как
 * единственный ключ сопоставления между аптеками разных сетей (D-06
 * явно оговаривает это).
 */
const EAN13_LENGTH = 13
const INTERNAL_PREFIX = '2'

export class Barcode {
  private constructor(readonly rawValue: string) {}

  /** `parse` НЕ бросает. Невалидный ввод → `Barcode` с `isValidEan13() === false`. */
  static parse(raw: string): Barcode {
    return new Barcode(raw)
  }

  /** Ровно 13 цифр И контрольная цифра (GS1) совпадает. */
  isValidEan13(): boolean {
    if (this.rawValue.length !== EAN13_LENGTH) {
      return false
    }
    if (!/^\d{13}$/.test(this.rawValue)) {
      return false
    }
    const digits = this.rawValue.split('').map((d) => Number.parseInt(d, 10))
    let sum = 0
    for (let i = 0; i < 12; i += 1) {
      const digit = digits[i]
      if (digit === undefined) return false
      // Позиции 1,3,5,7,9,11 (0-indexed: 0,2,4,6,8,10) — множитель 1
      // Позиции 2,4,6,8,10,12 (0-indexed: 1,3,5,7,9,11) — множитель 3
      sum += i % 2 === 0 ? digit : digit * 3
    }
    const expectedCheckDigit = (10 - (sum % 10)) % 10
    return digits[12] === expectedCheckDigit
  }

  /** Внутренний префикс продавца (D-06, SRS-DOM-075). Только для длины 13. */
  isInternalPrefix(): boolean {
    return this.rawValue.length === EAN13_LENGTH && this.rawValue.startsWith(INTERNAL_PREFIX)
  }

  /** `'ean13'` или `'non_ean13'` (SRS-DOM-076). */
  get format(): 'ean13' | 'non_ean13' {
    return this.rawValue.length === EAN13_LENGTH ? 'ean13' : 'non_ean13'
  }
}
