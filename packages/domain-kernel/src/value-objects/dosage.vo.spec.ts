import { describe, expect, it } from 'vitest'
import { Dosage } from './dosage.vo.js'
import { DosageUnit } from './dosage-unit.js'
import { DosageParseError, InvalidDosageError } from './dosage.errors.js'

describe('Dosage.create', () => {
  it('accepts positive finite values', () => {
    const result = Dosage.create(500, DosageUnit.mg)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.getValue()).toBe(500)
      expect(result.value.getUnit()).toBe(DosageUnit.mg)
    }
  })

  it('rejects zero', () => {
    const result = Dosage.create(0, DosageUnit.mg)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidDosageError)
    }
  })

  it('rejects negative values', () => {
    const result = Dosage.create(-1, DosageUnit.mg)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidDosageError)
    }
  })

  it('rejects NaN as not finite', () => {
    const result = Dosage.create(Number.NaN, DosageUnit.mg)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidDosageError)
      expect(result.error.message).toContain('not finite')
    }
  })

  it('rejects Infinity as not finite', () => {
    const result = Dosage.create(Number.POSITIVE_INFINITY, DosageUnit.mg)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidDosageError)
      expect(result.error.message).toContain('not finite')
    }
  })
})

describe('Dosage.isEquivalentTo (SRS-DOM-078, TC-DOM-012/013)', () => {
  it('500 mg equivalent to 0.5 g (mass family conversion)', () => {
    const a = Dosage.create(500, DosageUnit.mg)
    const b = Dosage.create(0.5, DosageUnit.g)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    }
  })

  it('500 mg equivalent to 500_000 mcg (mass family conversion)', () => {
    const a = Dosage.create(500, DosageUnit.mg)
    const b = Dosage.create(500_000, DosageUnit.mcg)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    }
  })

  it('500 mcg equivalent to 0.5 mg (TC-CAT-011)', () => {
    const a = Dosage.create(500, DosageUnit.mcg)
    const b = Dosage.create(0.5, DosageUnit.mg)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    }
  })

  it('500 mg NOT equivalent to 500 iu (different families)', () => {
    const a = Dosage.create(500, DosageUnit.mg)
    const b = Dosage.create(500, DosageUnit.iu)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(false)
    }
  })

  it('10 mg NOT equivalent to 10 ml (TC-CAT-012)', () => {
    const a = Dosage.create(10, DosageUnit.mg)
    const b = Dosage.create(10, DosageUnit.ml)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(false)
    }
  })

  it('500 mg NOT equivalent to 1000 mg (TC-CAT-010 — dosage strength difference, not combinable)', () => {
    const a = Dosage.create(500, DosageUnit.mg)
    const b = Dosage.create(1000, DosageUnit.mg)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(false)
    }
  })

  it('500 mg equivalent to 500 mg (equality by value, same unit)', () => {
    const a = Dosage.create(500, DosageUnit.mg)
    const b = Dosage.create(500, DosageUnit.mg)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    }
  })

  it('1 mcg NOT equivalent to 0.0009 mg (boundary: sub-microgram rounding must not create false equivalence)', () => {
    // 0.0009 mg = 0.9 mcg, округляется до 6 знаков в промежуточном bigint, но
    // ПОСЛЕ конвертации не должно совпасть с ровно 1 mcg — иначе строгое (0%)
    // сравнение (SRS-DOM-078) стало бы нестрогим.
    const a = Dosage.create(1, DosageUnit.mcg)
    const b = Dosage.create(0.0009, DosageUnit.mg)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(false)
    }
  })

  it('0.001 mg equivalent to 1 mcg (boundary: smallest representable microgram)', () => {
    const a = Dosage.create(0.001, DosageUnit.mg)
    const b = Dosage.create(1, DosageUnit.mcg)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    }
  })
})

describe('Dosage.parse', () => {
  it('parses "500 мг" with Cyrillic unit', () => {
    const result = Dosage.parse('500 мг')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.getValue()).toBe(500)
      expect(result.value.getUnit()).toBe(DosageUnit.mg)
    }
  })

  it('parses "10 мг/мл" with concentration form', () => {
    const result = Dosage.parse('10 мг/мл')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.getValue()).toBe(10)
      expect(result.value.getUnit()).toBe(DosageUnit.mgPerMl)
    }
  })

  it('parses "0.5 g" with Latin unit', () => {
    const result = Dosage.parse('0.5 g')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.getValue()).toBe(0.5)
      expect(result.value.getUnit()).toBe(DosageUnit.g)
    }
  })

  it('rejects empty string', () => {
    const result = Dosage.parse('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DosageParseError)
    }
  })

  it('rejects unknown unit', () => {
    const result = Dosage.parse('5 kg')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DosageParseError)
    }
  })

  it('rejects input with no leading number (fails the number+unit shape entirely)', () => {
    const result = Dosage.parse('mg')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DosageParseError)
      expect(result.error.message).toContain('mg')
    }
  })

  it('parses comma as decimal separator ("0,5 г")', () => {
    const result = Dosage.parse('0,5 г')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.getValue()).toBe(0.5)
      expect(result.value.getUnit()).toBe(DosageUnit.g)
    }
  })

  it('is idempotent: parsing the reconstructed "value unit" string yields an equivalent Dosage', () => {
    const first = Dosage.parse('500 мг')
    expect(first.ok).toBe(true)
    if (first.ok) {
      const reparsed = Dosage.parse(`${String(first.value.getValue())} ${first.value.getUnit()}`)
      expect(reparsed.ok).toBe(true)
      if (reparsed.ok) {
        expect(reparsed.value.getUnit()).toBe(first.value.getUnit())
        expect(reparsed.value.isEquivalentTo(first.value)).toBe(true)
      }
    }
  })
})
