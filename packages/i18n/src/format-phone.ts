/**
 * `formatPhone` (DTJ-402 п.9, `SRS-UX-031`/`SRS-DOM-069`) — маска отображения телефона
 * `+992 XX XXX XX XX`, одинаковая во всех локалях (номер — не переводимый текст).
 *
 * Принимает уже провалидированную E.164-подобную строку (контракт `PhoneNumber` VO,
 * `SRS-DOM-069`) — backend-код НЕ импортируется, только форматирует для отображения. Терпима к
 * пробелам/скобкам/дефисам во входной строке — вырезает всё, кроме цифр, до маскирования.
 */
const COUNTRY_CODE = '992'
const OPERATOR_CODE_LENGTH = 2
const GROUP_1_LENGTH = 3
const GROUP_2_LENGTH = 2
const GROUP_3_LENGTH = 2
const NATIONAL_DIGITS_COUNT = OPERATOR_CODE_LENGTH + GROUP_1_LENGTH + GROUP_2_LENGTH + GROUP_3_LENGTH

const OPERATOR_CODE_END = OPERATOR_CODE_LENGTH
const GROUP_1_END = OPERATOR_CODE_END + GROUP_1_LENGTH
const GROUP_2_END = GROUP_1_END + GROUP_2_LENGTH
const GROUP_3_END = GROUP_2_END + GROUP_3_LENGTH

export function formatPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '')
  const nationalDigits = (digits.startsWith(COUNTRY_CODE) ? digits.slice(COUNTRY_CODE.length) : digits).padEnd(
    NATIONAL_DIGITS_COUNT,
    ' ',
  )

  const operatorCode = nationalDigits.slice(0, OPERATOR_CODE_END).trimEnd()
  const part1 = nationalDigits.slice(OPERATOR_CODE_END, GROUP_1_END).trimEnd()
  const part2 = nationalDigits.slice(GROUP_1_END, GROUP_2_END).trimEnd()
  const part3 = nationalDigits.slice(GROUP_2_END, GROUP_3_END).trimEnd()

  return [`+${COUNTRY_CODE}`, operatorCode, part1, part2, part3].filter((segment) => segment !== '').join(' ')
}
