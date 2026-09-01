import { describe, expect, it } from 'vitest'
import { Barcode } from './barcode.vo.js'

describe('Barcode VO (DTJ-009, SRS-DOM-074..076)', () => {
  it('1. валидный EAN-13 (4870204347364 — реальный пример) → isValidEan13 true', () => {
    const b = Barcode.parse('4870204347364')
    expect(b.isValidEan13()).toBe(true)
    expect(b.format).toBe('ean13')
  })

  it('2. EAN-13 с изменённой контрольной цифрой (4870204347365) → isValidEan13 false (без исключения)', () => {
    const b = Barcode.parse('4870204347365')
    expect(b.isValidEan13()).toBe(false)
    expect(b.format).toBe('ean13')
  })

  it('3. EAN-13 с префиксом 2 (2001234567893) → isInternalPrefix true', () => {
    // Контрольная цифра: 2 0 0 1 2 3 4 5 6 7 8 9 → S = 2+0+0+3+2+9+4+15+6+21+8+27 = 97 → (10 - 7) % 10 = 3 ✓
    const b = Barcode.parse('2001234567893')
    expect(b.isValidEan13()).toBe(true)
    expect(b.isInternalPrefix()).toBe(true)
  })

  it('4. EAN-13 с префиксом 4 (4870204347364) → isInternalPrefix false', () => {
    const b = Barcode.parse('4870204347364')
    expect(b.isInternalPrefix()).toBe(false)
  })

  it('5. строка длиной 12 → format non_ean13, isValidEan13 false (без исключения)', () => {
    const b = Barcode.parse('123456789012')
    expect(b.format).toBe('non_ean13')
    expect(b.isValidEan13()).toBe(false)
  })

  it('6. строка с буквами → isValidEan13 false (без исключения)', () => {
    const b = Barcode.parse('ABC123456789')
    expect(b.isValidEan13()).toBe(false)
  })

  it('7. пустая строка → isValidEan13 false, rawValue сохранён', () => {
    const b = Barcode.parse('')
    expect(b.isValidEan13()).toBe(false)
    expect(b.rawValue).toBe('')
  })
})
