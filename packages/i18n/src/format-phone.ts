/**
 * `formatPhone` (DTJ-402, `SRS-UX-031`, `SRS-DOM-069`) — маска ОТОБРАЖЕНИЯ `+992 XX XXX XX XX`,
 * одинаковая во всех локалях (телефонные номера не переводятся).
 *
 * Принимает уже провалидированную E.164-подобную строку (контракт VO `PhoneNumber`,
 * `SRS-DOM-069`) — этот файл НЕ импортирует backend-код и НЕ валидирует номер, только
 * форматирует для отображения. Валидация — обязанность бэкенда/формы ввода выше по стеку.
 */
const COUNTRY_CODE = '992'
const DISPLAY_PREFIX = '+992'
const OPERATOR_CODE_GROUP_SIZE = 2
const EXCHANGE_GROUP_SIZE = 3
const LINE_GROUP_SIZE = 2
const LINE_SUFFIX_GROUP_SIZE = 2
const NATIONAL_GROUP_SIZES = [
  OPERATOR_CODE_GROUP_SIZE,
  EXCHANGE_GROUP_SIZE,
  LINE_GROUP_SIZE,
  LINE_SUFFIX_GROUP_SIZE,
] as const

/**
 * Given E.164-подобную строку (например `+992901234567` или `992901234567`), возвращает маску
 * отображения `+992 XX XXX XX XX`. Неполный ввод форматируется частично (сколько цифр есть).
 */
export function formatPhone(e164: string): string {
  const allDigits = e164.replace(/\D/g, '')
  const nationalDigits = allDigits.startsWith(COUNTRY_CODE) ? allDigits.slice(COUNTRY_CODE.length) : allDigits

  const groups: string[] = []
  let start = 0
  for (const size of NATIONAL_GROUP_SIZES) {
    const group = nationalDigits.slice(start, start + size)
    if (group.length === 0) {
      break
    }
    groups.push(group)
    start += size
  }

  return groups.length > 0 ? `${DISPLAY_PREFIX} ${groups.join(' ')}` : DISPLAY_PREFIX
}
