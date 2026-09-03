import { describe, expect, it } from 'vitest'
import { formatCheckoutMoney } from './format-money'

/**
 * `format-money.spec.ts` (DTJ-235) — тот же приём проверки, что `features/analogs/model/
 * format-savings.spec.ts` (DTJ-104): комма для `tj`/`ru` (через `toIntlLocale`), точка для `en`.
 */
describe('formatCheckoutMoney (DTJ-235)', () => {
  it('1. 12550 diram, locale tj (дефолт приложения) → "125,50" (запятая)', () => {
    expect(formatCheckoutMoney(12550, 'tj')).toBe('125,50')
  })

  it('2. locale en → точка как разделитель дробной части', () => {
    expect(formatCheckoutMoney(12550, 'en')).toBe('125.50')
  })

  it('3. locale ru → запятая (тот же кириллический разделитель, что tj)', () => {
    expect(formatCheckoutMoney(12550, 'ru')).toBe('125,50')
  })

  it('4. amountDiram=0 → "0,00"', () => {
    expect(formatCheckoutMoney(0, 'tj')).toBe('0,00')
  })

  it('5. без округления до круглых чисел — 6537 diram → "65,37"', () => {
    expect(formatCheckoutMoney(6537, 'tj')).toBe('65,37')
  })
})
