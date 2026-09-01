/**
 * `PhoneNumber` (EP-01, DTJ-008, SRS-DOM-080/081).
 *
 * Формат РТ (Республика Таджикистан): E.164 `+992XXXXXXXXX` (9 цифр после
 * кода страны `992` — мобильные номера операторов Tcell/Megafon/Beeline TJ
 * начинаются с `9`, фиксированные — с `3`/`4`/`5`/`6`/`7`). Допускается
 * ТОЛЬКО формат `+992...` — никаких `992...` без `+`, никаких локальных
 * `917...` без кода страны.
 *
 * Чистый VO: фабрика `parse(raw)` валидирует и бросает `InvalidPhoneNumberFormatError`
 * (из `packages/contracts`, маппится на HTTP 400 `INVALID_PHONE_FORMAT`, DTJ-018).
 * Никаких `@nestjs/*`/`drizzle-orm`/I/O — это `domain`-слой.
 *
 * Правило SRS-API-020: контроллер `POST /auth/otp/request` ОБЯЗАН делегировать
 * валидацию `PhoneNumber.parse` ДО применения rate-limit (лимит не должен
 * тратиться на заведомо невалидный номер).
 */
import { InvalidPhoneNumberFormatError } from '@dorutj/contracts'

/** Код страны РТ. Зафиксирован SRS-DOM-080. */
export const TAJIKISTAN_DIAL_CODE = '992'
/** 9 цифр после `+992` — формат всех операторов РТ (SRS-DOM-081). */
export const TAJIKISTAN_NATIONAL_NUMBER_LENGTH = 9
/** Первый символ национального номера — только мобильный `9` или фикс. `3..7`. */
const NATIONAL_FIRST_DIGIT_PATTERN = '[3-9]'

const E164_PATTERN = new RegExp(
  `^\\+${TAJIKISTAN_DIAL_CODE}\\d{${String(TAJIKISTAN_NATIONAL_NUMBER_LENGTH)}}$`,
)
const NATIONAL_PATTERN = new RegExp(
  `^${NATIONAL_FIRST_DIGIT_PATTERN}\\d{${String(TAJIKISTAN_NATIONAL_NUMBER_LENGTH - 1)}}$`,
)

export class PhoneNumber {
  private constructor(public readonly value: string) {}

  /**
   * Парсит сырую строку в `PhoneNumber`. Принимает:
   *   - E.164 `+992XXXXXXXXX` — основной формат API;
   *   - национальный `9XXXXXXXX` (9 цифр) — для удобства UI/тестов, нормализуется
   *     в E.164 автоматически.
   * Любой невалидный ввод → `InvalidPhoneNumberFormatError` (400).
   */
  static parse(raw: string): PhoneNumber {
    if (typeof raw !== 'string') {
      throw new InvalidPhoneNumberFormatError({ field: 'phone' })
    }
    const trimmed = raw.trim()
    if (E164_PATTERN.test(trimmed)) {
      return new PhoneNumber(trimmed)
    }
    if (NATIONAL_PATTERN.test(trimmed)) {
      return new PhoneNumber(`+${TAJIKISTAN_DIAL_CODE}${trimmed}`)
    }
    throw new InvalidPhoneNumberFormatError({
      field: 'phone',
      receivedLength: trimmed.length,
    })
  }

  equals(other: PhoneNumber): boolean {
    return this.value === other.value
  }

  /** Без префикса `+992`, для компактного хранения в БД (SRS-DB-006). */
  toNationalNumber(): string {
    return this.value.slice(TAJIKISTAN_DIAL_CODE.length + 1)
  }

  toString(): string {
    return this.value
  }
}
