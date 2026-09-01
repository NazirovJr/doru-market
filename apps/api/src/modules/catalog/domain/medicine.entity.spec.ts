import { describe, expect, it } from 'vitest'
import { DosageForm, DosageFormClass, DosageUnit, isOk } from '@dorutj/domain-kernel'
import { ControlCategory, CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE } from './medicine.enums.js'
import { Medicine } from './medicine.entity.js'
import { ControlCategoryChangeRequiresModerationError } from './errors/control-category-change-requires-moderation.error.js'
import { InvalidMedicineStateError } from './errors/invalid-medicine-state.error.js'
import { MissingSubstancesError } from './errors/missing-substances.error.js'

const SUBSTANCE_PARACETAMOL_ID = '11111111-1111-1111-1111-111111111111'

const tabletFormResult = DosageForm.create(DosageFormClass.tablet)
if (!isOk(tabletFormResult)) {
  throw new Error('Test setup: tablet dosage form class is always valid')
}

const validCommand = {
  id: '22222222-2222-2222-2222-222222222222',
  tradeName: 'Цитрамон П',
  innName: 'Acetylsalicylic acid + Caffeine + Paracetamol',
  categoryId: 1,
  dosageForm: tabletFormResult.value,
  dosageStrengthRaw: '500 мг',
  manufacturerCountry: 'Tajikistan',
  manufacturerName: 'Test Pharma',
  isPrescriptionRequired: false,
  controlCategory: ControlCategory.none,
  requiresColdChain: false,
  imageUrl: null,
  descriptionTj: null,
  descriptionRu: null,
  substances: [{ substanceId: SUBSTANCE_PARACETAMOL_ID, strengthValue: 500, strengthUnit: DosageUnit.mg }],
} as const

describe('Medicine.create (SRS-DOM-013, SRS-DOM-015)', () => {
  it('creates medicine with non-empty substances', () => {
    const result = Medicine.create(validCommand)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.getId()).toBe(validCommand.id)
      expect(result.value.isPublished()).toBe(false)
      expect(result.value.getSubstances()).toHaveLength(1)
    }
  })

  it('rejects empty substances', () => {
    const result = Medicine.create({ ...validCommand, substances: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidMedicineStateError)
    }
  })

  it('rejects potent controlCategory without isPrescriptionRequired', () => {
    const result = Medicine.create({
      ...validCommand,
      controlCategory: ControlCategory.potent,
      isPrescriptionRequired: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidMedicineStateError)
    }
  })

  it('rejects narcotic without isPrescriptionRequired', () => {
    const result = Medicine.create({
      ...validCommand,
      controlCategory: ControlCategory.narcotic,
      isPrescriptionRequired: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidMedicineStateError)
    }
  })

  it('accepts potent with isPrescriptionRequired=true', () => {
    const result = Medicine.create({
      ...validCommand,
      controlCategory: ControlCategory.potent,
      isPrescriptionRequired: true,
    })
    expect(result.ok).toBe(true)
  })
})

describe('Medicine.publish (SRS-DOM-013)', () => {
  it('publishes when substances present, returns event', () => {
    const created = Medicine.create(validCommand)
    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }
    // Domain-метод `Medicine.publish(now: Date)` обязан принять `Date` по контракту (`02` §2.6).
    // Тест детерминирован: ниже сравнивается ISO-строка фиксированной точки.
    // eslint-disable-next-line no-restricted-globals -- доменный метод `Medicine.publish(now: Date)` принимает `Date` по контракту (02 §2.6); тест детерминирован (ниже сравнивается ISO-строка фиксированной точки).
    const published = created.value.publish(new Date('2026-01-01T00:00:00.000Z'))
    expect(published.ok).toBe(true)
    if (published.ok) {
      expect(published.value.medicineId).toBe(validCommand.id)
      expect(published.value.publishedAt).toBe('2026-01-01T00:00:00.000Z')
    }
    expect(created.value.isPublished()).toBe(true)
  })

  it('rejects publish on empty-substances medicine', () => {
    const result = Medicine.create({ ...validCommand, substances: [] })
    expect(result.ok).toBe(false)
  })
})

describe('Medicine.proposeControlCategory (SRS-DOM-014)', () => {
  it('returns event without mutating controlCategory', () => {
    const created = Medicine.create(validCommand)
    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }
    const initialCategory = created.value.getControlCategory()
    const proposed = created.value.proposeControlCategory(
      ControlCategory.potent,
      'moderator-1',
      // eslint-disable-next-line no-restricted-globals -- `now: Date` — параметр доменного метода по контракту.
      new Date('2026-01-01T00:00:00.000Z'),
    )
    expect(proposed.ok).toBe(true)
    if (proposed.ok) {
      expect(proposed.value.proposedCategory).toBe(ControlCategory.potent)
      expect(proposed.value.actorId).toBe('moderator-1')
    }
    // SRS-DOM-014: НЕ мутирует
    expect(created.value.getControlCategory()).toBe(initialCategory)
  })

  it('rejects proposal equal to current', () => {
    const created = Medicine.create(validCommand)
    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }
    const proposed = created.value.proposeControlCategory(
      ControlCategory.none,
      'moderator-1',
      // eslint-disable-next-line no-restricted-globals -- `now: Date` — параметр доменного метода по контракту.
      new Date(),
    )
    expect(proposed.ok).toBe(false)
    if (!proposed.ok) {
      expect(proposed.error).toBeInstanceOf(ControlCategoryChangeRequiresModerationError)
    }
  })
})

describe('Medicine.canOrderRemotely (D-08, SRS-CAT-006)', () => {
  it('rejects narcotic even when published', () => {
    const created = Medicine.create({
      ...validCommand,
      controlCategory: ControlCategory.narcotic,
      isPrescriptionRequired: true,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }
    // eslint-disable-next-line no-restricted-globals -- `now: Date` — параметр доменного метода по контракту.
    const published = created.value.publish(new Date())
    expect(published.ok).toBe(true)
    expect(created.value.canOrderRemotely()).toBe(false)
  })

  it('rejects psychotropic even when published', () => {
    const created = Medicine.create({
      ...validCommand,
      controlCategory: ControlCategory.psychotropic,
      isPrescriptionRequired: true,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }
    // eslint-disable-next-line no-restricted-globals -- `now: Date` — параметр доменного метода по контракту.
    created.value.publish(new Date())
    expect(created.value.canOrderRemotely()).toBe(false)
  })

  it('allows none when published', () => {
    const created = Medicine.create(validCommand)
    if (created.ok) {
      // eslint-disable-next-line no-restricted-globals -- `now: Date` — параметр доменного метода по контракту.
      created.value.publish(new Date())
      expect(created.value.canOrderRemotely()).toBe(true)
    }
  })
})

describe('Medicine.attachBarcode (SRS-DOM-016, D-06)', () => {
  it('sets isGloballyIdentifiableByBarcode for valid EAN-13 with non-2 prefix', () => {
    const created = Medicine.create(validCommand)
    if (!created.ok) {
      return
    }
    created.value.attachBarcode('4870123456789')
    expect(created.value.isGloballyIdentifiableByBarcode()).toBe(true)
  })

  it('clears flag for internal prefix 2', () => {
    const created = Medicine.create(validCommand)
    if (!created.ok) {
      return
    }
    created.value.attachBarcode('2001234567893')
    expect(created.value.isGloballyIdentifiableByBarcode()).toBe(false)
  })

  it('clears flag for non-EAN13 raw value', () => {
    const created = Medicine.create(validCommand)
    if (!created.ok) {
      return
    }
    created.value.attachBarcode('SKU-12345')
    expect(created.value.isGloballyIdentifiableByBarcode()).toBe(false)
  })
})

describe('Medicine.applyModeratedControlCategory (private path)', () => {
  it('rejects potent without isPrescriptionRequired', () => {
    const created = Medicine.create(validCommand)
    if (!created.ok) {
      return
    }
    expect(() => {
      created.value.applyModeratedControlCategory(ControlCategory.potent)
    }).toThrow(InvalidMedicineStateError)
  })
})

describe('MissingSubstancesError exported', () => {
  it('has code MISSING_SUBSTANCES', () => {
    const err = new MissingSubstancesError('test')
    expect(err.code).toBe('MISSING_SUBSTANCES')
  })
})

describe('CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE invariant', () => {
  it('contains psychotropic and narcotic only', () => {
    expect(CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(ControlCategory.psychotropic)).toBe(true)
    expect(CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(ControlCategory.narcotic)).toBe(true)
    expect(CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(ControlCategory.potent)).toBe(false)
    expect(CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(ControlCategory.none)).toBe(false)
  })
})
