import { describe, expect, it } from 'vitest'
import { formatSavings } from './format-savings'

/**
 * `format-savings.spec.ts` (DTJ-104, `SRS-CAT-038`, `TC-CAT-013`).
 *
 * Ожидания ниже ПРОВЕРЕНЫ И В Node (эта тестовая среда), И вручную в реальном Chromium (Browser-
 * инструмент, живой `/medicines/:id` со смоканным `fetch`) — см. `format-savings.ts` (JSDoc) и
 * DISPUTED отчёта сдачи DTJ-104: для дефолтной локали `'tj'` реальный вывод — ЗАПЯТАЯ («65,00»),
 * не точка буквального примера TC-CAT-013 («65.00») — расхождение объяснено и зафиксировано, не
 * тихая правка требования.
 */
describe('formatSavings (DTJ-104)', () => {
  it('1. 6500 diram, локаль tj (дефолт приложения) → "65,00" (запятая — см. JSDoc format-savings.ts)', () => {
    expect(formatSavings(6500, 'tj')).toBe('65,00')
  })

  it('2. разброс НЕ округляется до «круглых» чисел (REQ-MARKET-3, ×9.8–10) — 6537 diram → "65,37", не "65"/"70"', () => {
    expect(formatSavings(6537, 'tj')).toBe('65,37')
  })

  it('3. мелкая сумма без потери точности — 1 diram → "0,01"', () => {
    expect(formatSavings(1, 'tj')).toBe('0,01')
  })

  it('4. locale="en" — точка как разделитель дробной части', () => {
    expect(formatSavings(6500, 'en')).toBe('65.00')
  })

  it('5. locale="ru" — тоже запятая (тот же кириллический десятичный разделитель, что и tj)', () => {
    expect(formatSavings(6500, 'ru')).toBe('65,00')
  })

  it('6. большая сумма — группировка тысяч (неразрывный пробел U+00A0 для tj/tg), ровно 2 знака, без округления', () => {
    expect(formatSavings(733897, 'tj')).toBe('7 338,97')
  })

  it('7. amountDiram=0 (граница) → "0,00"', () => {
    expect(formatSavings(0, 'tj')).toBe('0,00')
  })
})
