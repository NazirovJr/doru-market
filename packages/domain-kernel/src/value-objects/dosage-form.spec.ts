import { describe, expect, it } from 'vitest'
import { DosageForm, DosageFormClass, InvalidDosageFormError } from './dosage-form.js'

describe('DosageForm.isEquivalentTo (SRS-DOM-079, SRS-CAT-032/033, TC-CAT-008/009)', () => {
  it('tablet equivalent to tablet', () => {
    const a = DosageForm.create(DosageFormClass.tablet)
    const b = DosageForm.create(DosageFormClass.tablet)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    }
  })

  it('tablet NOT equivalent to capsule (TC-CAT-008, diagonal-only)', () => {
    const a = DosageForm.create(DosageFormClass.tablet)
    const b = DosageForm.create(DosageFormClass.capsule)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(false)
    }
  })

  it('syrup NOT equivalent to injection (TC-CAT-009, different route of administration)', () => {
    const a = DosageForm.create(DosageFormClass.syrup)
    const b = DosageForm.create(DosageFormClass.injection)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.isEquivalentTo(b.value)).toBe(false)
    }
  })
})

describe('DosageForm.fromString', () => {
  it('accepts known class', () => {
    const result = DosageForm.fromString('tablet')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.getFormClass()).toBe(DosageFormClass.tablet)
    }
  })

  it('rejects unknown class', () => {
    const result = DosageForm.fromString('pill')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidDosageFormError)
    }
  })
})
