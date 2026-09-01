import { describe, expect, it } from 'vitest'
import { Barcode } from './barcode.vo.js'

/** Эталонные EAN-13 с корректной контрольной цифрой (стандартный алгоритм GS1). */
const VALID_EAN_13 = '4870123456789'
/** Та же цифра, последняя намеренно изменена: 9 → 0. */
const INVALID_EAN_13 = '4870123456780'
const INTERNAL_PREFIX_EAN_13 = '2001234567893'

describe('Barcode.parse (SRS-DOM-074..076)', () => {
  it('accepts valid EAN-13 and marks isValidEan13()=true', () => {
    const bc = Barcode.parse(VALID_EAN_13)
    expect(bc.getFormat()).toBe('ean13')
    expect(bc.isValidEan13()).toBe(true)
    expect(bc.isInternalPrefix()).toBe(false)
  })

  it('detects invalid EAN-13 checksum (format kept, isValidEan13()=false)', () => {
    const bc = Barcode.parse(INVALID_EAN_13)
    expect(bc.getFormat()).toBe('ean13')
    expect(bc.isValidEan13()).toBe(false)
  })

  it('detects internal prefix 2 (D-06) on valid EAN-13', () => {
    const bc = Barcode.parse(INTERNAL_PREFIX_EAN_13)
    expect(bc.getFormat()).toBe('ean13')
    expect(bc.isValidEan13()).toBe(true)
    expect(bc.isInternalPrefix()).toBe(true)
    expect(bc.isGloballyIdentifiable()).toBe(false)
  })

  it('accepts 8-digit string as non_ean13 without throwing', () => {
    const bc = Barcode.parse('12345678')
    expect(bc.getFormat()).toBe('non_ean13')
    expect(bc.isValidEan13()).toBe(false)
  })

  it('accepts 12-digit string as non_ean13', () => {
    const bc = Barcode.parse('123456789012')
    expect(bc.getFormat()).toBe('non_ean13')
  })

  it('trims surrounding whitespace', () => {
    const bc = Barcode.parse(`  ${VALID_EAN_13}  `)
    expect(bc.getFormat()).toBe('ean13')
    expect(bc.isValidEan13()).toBe(true)
  })
})

describe('Barcode.isGloballyIdentifiable (D-06)', () => {
  it('valid EAN-13 with non-2 prefix is globally identifiable', () => {
    expect(Barcode.parse(VALID_EAN_13).isGloballyIdentifiable()).toBe(true)
  })

  it('valid EAN-13 with internal prefix 2 is NOT globally identifiable', () => {
    expect(Barcode.parse(INTERNAL_PREFIX_EAN_13).isGloballyIdentifiable()).toBe(false)
  })

  it('non-ean13 raw value is NOT globally identifiable', () => {
    expect(Barcode.parse('abc-123').isGloballyIdentifiable()).toBe(false)
  })
})
