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
})
