/**
 * Тест `MedicineMapper` (DTJ-092, EP-04, R1) — round-trip эквивалентность
 * `toDomain(row)` / `toRecord(medicine, barcode)` для `Medicine`.
 *
 * Тест UNIT-уровня (без БД). Подтверждает, что:
 *   1. Поля, которые mapper читает/пишет, переживают туда-обратно без потерь
 *      (`id`, `tradeName`, `innName`, `categoryId`, `dosageFormClass`,
 *      `dosageStrength`, `manufacturerCountry`, `manufacturerName`,
 *      `isPrescriptionRequired`, `controlCategory`, `isPublished`,
 *      `requiresColdChain`, `imageUrl`, `descriptionTj/Ru`, `substances`).
 *   2. `num` (Drizzle NUMERIC) принимается как `number | string`.
 *   3. Невалидный `dosageFormClass`/`controlCategory`/`dosageUnit` бросает.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.6 (Волна 4, EP-04)
 */
import { describe, expect, it } from 'vitest'
import { DosageForm, DosageUnit } from '@dorutj/domain-kernel'
import { ControlCategory, DosageFormClass } from '@/modules/catalog/domain/medicine.enums.js'
import { Medicine, type MedicineCreateCommand } from '@/modules/catalog/domain/medicine.entity.js'
import { toDomain, toDomainSafe, toRecord, type MedicineRowLike, type SubstanceRowLike } from './medicine.mapper.js'

const SUBSTANCE_A = '11111111-1111-4111-8111-111111111111'
const SUBSTANCE_B = '22222222-2222-4222-8222-222222222222'

const TABLET_FORM_RESULT = DosageForm.create(DosageFormClass.tablet)
if (!TABLET_FORM_RESULT.ok) {
  throw new Error('Test setup: tablet dosage form create failed')
}
const TABLET_FORM = TABLET_FORM_RESULT.value

function makeMedicine(): Medicine {
  const cmd: MedicineCreateCommand = {
    id: '33333333-3333-4333-8333-333333333333',
    tradeName: 'Paracetamol',
    innName: 'INN-Paracetamol',
    categoryId: 7,
    dosageForm: TABLET_FORM,
    dosageStrengthRaw: '500 мг',
    manufacturerCountry: 'Tajikistan',
    manufacturerName: 'Test Pharma',
    isPrescriptionRequired: false,
    controlCategory: ControlCategory.none,
    requiresColdChain: false,
    imageUrl: null,
    descriptionTj: null,
    descriptionRu: null,
    substances: [
      { substanceId: SUBSTANCE_A, strengthValue: 500, strengthUnit: DosageUnit.mg },
      { substanceId: SUBSTANCE_B, strengthValue: 250, strengthUnit: DosageUnit.mg },
    ],
  }
  const result = Medicine.create(cmd)
  if (!result.ok) {
    throw new Error(`Test setup: cannot create medicine: ${result.error.message}`)
  }
  // Опубликуем, чтобы проверить сохранение `isPublished`
  const published = result.value.publish(new Date('2026-01-01T00:00:00.000Z'))
  if (!published.ok) {
    throw new Error(`Test setup: cannot publish: ${published.error.message}`)
  }
  return result.value
}

function makeRowLike(medicine: Medicine, barcode: string | null = '4870123456789'): MedicineRowLike {
  return {
    id: medicine.getId(),
    tradeName: medicine.getTradeName(),
    innName: medicine.getInnName(),
    barcode,
    isGloballyIdentifiableByBarcode: medicine.isGloballyIdentifiableByBarcode(),
    categoryId: medicine.getCategoryId(),
    dosageForm: medicine.getDosageForm().getFormClass(),
    dosageFormClass: medicine.getDosageForm().getFormClass(),
    dosageStrength: medicine.getDosageStrengthRaw(),
    manufacturerCountry: medicine.getManufacturerCountry(),
    manufacturerName: medicine.getManufacturerName(),
    isPrescriptionRequired: medicine.isPrescriptionRequired(),
    controlCategory: medicine.getControlCategory(),
    isPublished: medicine.isPublished(),
    requiresColdChain: medicine.requiresColdChain(),
    imageUrl: medicine.getImageUrl(),
    descriptionTj: medicine.getDescriptionTj(),
    descriptionRu: medicine.getDescriptionRu(),
  }
}

function makeSubstances(medicine: Medicine): SubstanceRowLike[] {
  return medicine.getSubstances().map((s) => ({
    substanceId: s.substanceId,
    strengthValue: s.strengthValue,
    strengthUnit: s.strengthUnit,
  }))
}

describe('MedicineMapper (DTJ-092, SRS-CAT-005)', () => {
  it('round-trip: toDomain(row, subs) → toRecord(med, barcode) сохраняет инварианты', () => {
    const original = makeMedicine()
    const row = makeRowLike(original)
    const substances = makeSubstances(original)
    const restored = toDomain(row, substances)

    expect(restored.getId()).toBe(original.getId())
    expect(restored.getTradeName()).toBe(original.getTradeName())
    expect(restored.getInnName()).toBe(original.getInnName())
    expect(restored.getCategoryId()).toBe(original.getCategoryId())
    expect(restored.getDosageForm().getFormClass()).toBe(original.getDosageForm().getFormClass())
    expect(restored.getDosageStrengthRaw()).toBe(original.getDosageStrengthRaw())
    expect(restored.getManufacturerCountry()).toBe(original.getManufacturerCountry())
    expect(restored.getManufacturerName()).toBe(original.getManufacturerName())
    expect(restored.isPrescriptionRequired()).toBe(original.isPrescriptionRequired())
    expect(restored.getControlCategory()).toBe(original.getControlCategory())
    expect(restored.isPublished()).toBe(original.isPublished())
    expect(restored.requiresColdChain()).toBe(original.requiresColdChain())
    expect(restored.isGloballyIdentifiableByBarcode()).toBe(original.isGloballyIdentifiableByBarcode())

    const substancesRestored = restored.getSubstances()
    expect(substancesRestored).toHaveLength(original.getSubstances().length)
    const mapRestored = new Map(substancesRestored.map((s) => [s.substanceId, s.strengthValue]))
    const mapOriginal = new Map(original.getSubstances().map((s) => [s.substanceId, s.strengthValue]))
    expect(mapRestored).toEqual(mapOriginal)

    const record = toRecord(restored, '4870123456789')
    expect(record.id).toBe(original.getId())
    expect(record.barcode).toBe('4870123456789')
    expect(record.dosageFormClass).toBe(DosageFormClass.tablet)
    expect(record.controlCategory).toBe(ControlCategory.none)
  })

  it('принимает strengthValue как строку (NUMERIC(10,4) из Drizzle)', () => {
    const original = makeMedicine()
    const row = makeRowLike(original)
    const substances: SubstanceRowLike[] = [
      { substanceId: SUBSTANCE_A, strengthValue: '500.0000', strengthUnit: 'mg' },
      { substanceId: SUBSTANCE_B, strengthValue: '250.0000', strengthUnit: 'mg' },
    ]
    const restored = toDomain(row, substances)
    expect(restored.getSubstances()[0]?.strengthValue).toBe(500)
    expect(restored.getSubstances()[1]?.strengthValue).toBe(250)
  })

  it('toDomainSafe возвращает ok=true для валидной строки', () => {
    const original = makeMedicine()
    const row = makeRowLike(original)
    const r = toDomainSafe(row, makeSubstances(original))
    expect(r.ok).toBe(true)
  })

  it('toDomainSafe возвращает ok=false для невалидного dosageFormClass', () => {
    const original = makeMedicine()
    const row = { ...makeRowLike(original), dosageFormClass: 'totally-invalid' }
    const r = toDomainSafe(row, makeSubstances(original))
    expect(r.ok).toBe(false)
  })

  it('toDomainSafe возвращает ok=false для невалидного controlCategory', () => {
    const original = makeMedicine()
    const row = { ...makeRowLike(original), controlCategory: 'unknown_category' }
    const r = toDomainSafe(row, makeSubstances(original))
    expect(r.ok).toBe(false)
  })

  it('toDomainSafe возвращает ok=false для невалидного dosageUnit', () => {
    const original = makeMedicine()
    const row = makeRowLike(original)
    const substances: SubstanceRowLike[] = [
      { substanceId: SUBSTANCE_A, strengthValue: 500, strengthUnit: 'unknown_unit' },
    ]
    const r = toDomainSafe(row, substances)
    expect(r.ok).toBe(false)
  })
})