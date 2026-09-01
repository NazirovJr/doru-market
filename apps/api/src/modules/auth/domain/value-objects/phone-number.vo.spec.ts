/**
 * Тест `PhoneNumber` (EP-01, DTJ-008, SRS-DOM-080/081). Фиксирует формат
 * РТ-номера и поведение `parse`/`toNationalNumber`/`equals`.
 */
import { describe, expect, it } from 'vitest'
import { InvalidPhoneNumberFormatError } from '@dorutj/contracts'
import { PhoneNumber, TAJIKISTAN_DIAL_CODE } from './phone-number.vo.js'

const VALID_E164 = `+${TAJIKISTAN_DIAL_CODE}917123456`
const VALID_NATIONAL = '917123456'

describe('PhoneNumber (DTJ-008, SRS-DOM-080/081)', () => {
  it('принимает валидный E.164 (+992XXXXXXXXX)', () => {
    const p = PhoneNumber.parse(VALID_E164)
    expect(p.value).toBe(VALID_E164)
    expect(p.toNationalNumber()).toBe(VALID_NATIONAL)
  })

  it('нормализует национальный 9-значный номер в E.164', () => {
    const p = PhoneNumber.parse(VALID_NATIONAL)
    expect(p.value).toBe(VALID_E164)
  })

  it('принимает фиксированный номер (3..7)', () => {
    const p = PhoneNumber.parse(`+${TAJIKISTAN_DIAL_CODE}371234567`)
    expect(p.value).toBe(`+${TAJIKISTAN_DIAL_CODE}371234567`)
  })

  it.each([
    ['без кода страны', '9171234567'],
    ['другой код страны', '+79001234567'],
    ['короче 9 цифр', `+${TAJIKISTAN_DIAL_CODE}91712345`],
    ['длиннее 9 цифр', `+${TAJIKISTAN_DIAL_CODE}9171234567`],
    ['не цифры', `+${TAJIKISTAN_DIAL_CODE}abc123456`],
    ['пустая строка', ''],
  ])('отклоняет невалидный ввод (%s)', (_label, input) => {
    expect(() => PhoneNumber.parse(input)).toThrow(InvalidPhoneNumberFormatError)
  })

  it('equals сравнивает по нормализованному значению', () => {
    const a = PhoneNumber.parse(VALID_E164)
    const b = PhoneNumber.parse(VALID_NATIONAL)
    expect(a.equals(b)).toBe(true)
  })
})
