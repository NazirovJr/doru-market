import { describe, expect, it } from 'vitest'
import { DosageForm, DosageFormClass, DosageUnit, isOk } from '@dorutj/domain-kernel'
import { ControlCategory } from '../medicine.enums.js'
import { Medicine } from '../medicine.entity.js'
import { AnalogEquivalenceService } from './analog-equivalence.service.js'

const PARACETAMOL_ID = '11111111-1111-1111-1111-111111111111'
const CAFFEINE_ID = '22222222-2222-2222-2222-222222222222'
const IBUPROFEN_ID = '33333333-3333-3333-3333-333333333333'

const baseCmd = {
  categoryId: 1,
  manufacturerCountry: 'TJ',
  manufacturerName: 'Test',
  isPrescriptionRequired: false,
  controlCategory: ControlCategory.none,
  requiresColdChain: false,
  imageUrl: null,
  descriptionTj: null,
  descriptionRu: null,
} as const

/* eslint-disable max-params -- test helper, нагляднее позиционные аргументы в каждом it() */
const makeMedicine = (
  id: string,
  tradeName: string,
  innName: string,
  formClass: DosageFormClass,
  dosageStrengthRaw: string,
  substances: { substanceId: string; strengthValue: number; strengthUnit: DosageUnit }[],
): Medicine => {
  const dosageFormResult = DosageForm.create(formClass)
  if (!isOk(dosageFormResult)) {
    throw new Error(`Invalid dosage form class in test: ${formClass}`)
  }
  const result = Medicine.create({
    id,
    tradeName,
    innName,
    ...baseCmd,
    dosageForm: dosageFormResult.value,
    dosageStrengthRaw,
    substances,
  })
  if (!result.ok) {
    throw new Error(`Medicine.create failed: ${result.error.message}`)
  }
  return result.value
}

describe('AnalogEquivalenceService.isAnalog (SRS-CAT-031, TC-CAT-008..012, TC-DOM-014)', () => {
  const service = new AnalogEquivalenceService()

  it('returns false for the same medicine (self)', () => {
    const a = makeMedicine(
      'a-1',
      'A',
      'inn',
      DosageFormClass.tablet,
      '500 мг',
      [{ substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg }],
    )
    expect(service.isAnalog(a, a)).toBe(false)
  })

  it('TC-CAT-010: 500 mg vs 1000 mg — NOT analogs (no multiplicity equivalence, SRS-CAT-035)', () => {
    const a = makeMedicine(
      'a-1',
      'BrandA',
      'inn',
      DosageFormClass.tablet,
      '500 мг',
      [{ substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg }],
    )
    const b = makeMedicine(
      'b-1',
      'BrandB',
      'inn',
      DosageFormClass.tablet,
      '1000 мг',
      [{ substanceId: PARACETAMOL_ID, strengthValue: 1000, strengthUnit: DosageUnit.mg }],
    )
    expect(service.isAnalog(a, b)).toBe(false)
  })

  it('identical substance+form+strength across manufacturers = analogs', () => {
    const a = makeMedicine(
      'a-1',
      'BrandA',
      'inn',
      DosageFormClass.tablet,
      '500 мг',
      [{ substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg }],
    )
    const b = makeMedicine(
      'b-1',
      'BrandB',
      'inn',
      DosageFormClass.tablet,
      '500 мг',
      [{ substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg }],
    )
    expect(service.isAnalog(a, b)).toBe(true)
  })

  it('TC-CAT-008: tablet vs capsule — NOT analogs (diagonal matrix, SRS-CAT-033)', () => {
    const a = makeMedicine(
      'a-1',
      'BrandA',
      'inn',
      DosageFormClass.tablet,
      '500 мг',
      [{ substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg }],
    )
    const b = makeMedicine(
      'b-1',
      'BrandB',
      'inn',
      DosageFormClass.capsule,
      '500 мг',
      [{ substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg }],
    )
    expect(service.isAnalog(a, b)).toBe(false)
  })

  it('TC-CAT-009: syrup vs injection — NOT analogs', () => {
    const a = makeMedicine(
      'a-1',
      'A',
      'inn',
      DosageFormClass.syrup,
      '10 мл',
      [{ substanceId: IBUPROFEN_ID, strengthValue: 10, strengthUnit: DosageUnit.ml }],
    )
    const b = makeMedicine(
      'b-1',
      'B',
      'inn',
      DosageFormClass.injection,
      '10 мл',
      [{ substanceId: IBUPROFEN_ID, strengthValue: 10, strengthUnit: DosageUnit.ml }],
    )
    expect(service.isAnalog(a, b)).toBe(false)
  })

  it('TC-DOM-014: partial intersection {paracetamol} vs {paracetamol, caffeine} — NOT analogs', () => {
    const a = makeMedicine(
      'a-1',
      'A',
      'inn',
      DosageFormClass.tablet,
      '500 мг',
      [{ substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg }],
    )
    const b = makeMedicine(
      'b-1',
      'B',
      'inn',
      DosageFormClass.tablet,
      '500 мг',
      [
        { substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg },
        { substanceId: CAFFEINE_ID, strengthValue: 50, strengthUnit: DosageUnit.mg },
      ],
    )
    expect(service.isAnalog(a, b)).toBe(false)
  })

  it('different substances — NOT analogs', () => {
    const a = makeMedicine(
      'a-1',
      'A',
      'inn',
      DosageFormClass.tablet,
      '500 мг',
      [{ substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg }],
    )
    const b = makeMedicine(
      'b-1',
      'B',
      'inn',
      DosageFormClass.tablet,
      '500 мг',
      [{ substanceId: IBUPROFEN_ID, strengthValue: 500, strengthUnit: DosageUnit.mg }],
    )
    expect(service.isAnalog(a, b)).toBe(false)
  })

  it('identical combination of 3 substances — analogs', () => {
    const substances = [
      { substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg },
      { substanceId: CAFFEINE_ID, strengthValue: 50, strengthUnit: DosageUnit.mg },
      { substanceId: IBUPROFEN_ID, strengthValue: 200, strengthUnit: DosageUnit.mg },
    ]
    const a = makeMedicine('a-1', 'A', 'inn', DosageFormClass.tablet, '500 мг', substances)
    const b = makeMedicine('b-1', 'B', 'inn', DosageFormClass.tablet, '500 мг', substances)
    expect(service.isAnalog(a, b)).toBe(true)
  })

  it('combination with one mismatched strength — NOT analogs', () => {
    const a = makeMedicine('a-1', 'A', 'inn', DosageFormClass.tablet, '500 мг', [
      { substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg },
      { substanceId: CAFFEINE_ID, strengthValue: 50, strengthUnit: DosageUnit.mg },
    ])
    const b = makeMedicine('b-1', 'B', 'inn', DosageFormClass.tablet, '500 мг', [
      { substanceId: PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg },
      { substanceId: CAFFEINE_ID, strengthValue: 100, strengthUnit: DosageUnit.mg },
    ])
    expect(service.isAnalog(a, b)).toBe(false)
  })
})
