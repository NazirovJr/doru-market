/**
 * Тест `toMedicineDetailDto` (DTJ-095, SRS-CAT-049) — сверяет JSON-контракт
 * карточки товара с тем, что прописано в SRS-CAT-049 буквально. Не дёргает
 * HTTP — это unit-тест маппера.
 *
 * Проверяемые инварианты:
 *   1. Все обязательные поля SRS-CAT-049 присутствуют (id, tradeName, innName, dosageForm,
 *      dosageFormClass, dosageStrength, manufacturerName, manufacturerCountry,
 *      controlCategory, isPrescriptionRequired, requiresColdChain, imageUrl, description,
 *      substances, offers, hasAnalogs).
 *   2. `substances[]` маппится с `substanceId`/`strengthValue`/`strengthUnit`.
 *   3. `imageUrl: null` сохраняется как `null` (НЕ подменяется на плейсхолдер — SRS-CAT-007:
 *      бэкенд не рендерит SVG, фронт по `dosageFormClass`).
 *   4. `controlCategory` строковый enum уже в БД-форме (`prescription_only`, не `prescriptionOnly`).
 *   5. `offers: []` и `hasAnalogs: false` проходят как есть (TODO-стабы).
 *
 * @see docs/spec/20-module-catalog-search.md SRS-CAT-049
 */
import { describe, expect, it } from 'vitest'
import { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'
import type { MedicineRecord } from '@/modules/catalog/domain/medicine.types.js'
import type { MedicineDetail } from '@/modules/catalog/application/use-cases/get-medicine-detail.use-case.js'
import { toMedicineDetailDto } from '@/modules/catalog/presentation/dto/medicine-detail.dto.js'

function makeRecord(overrides: Partial<MedicineRecord> = {}): MedicineRecord {
  const base: MedicineRecord = {
    id: '00000000-0000-4000-8000-000000000001',
    tradeName: 'Nurofen',
    innName: 'Ibuprofen',
    barcode: '4601234567890',
    isGloballyIdentifiableByBarcode: true,
    categoryId: 1,
    dosageForm: 'tablet',
    dosageFormClass: 'tablet' as MedicineRecord['dosageFormClass'],
    dosageStrength: '200 mg',
    manufacturerCountry: 'Tajikistan',
    manufacturerName: 'DoruTJ Pharma',
    isPrescriptionRequired: false,
    controlCategory: ControlCategory.none,
    isPublished: true,
    requiresColdChain: false,
    imageUrl: 'https://cdn.example/nurofen.png',
    descriptionTj: 'Тадж',
    descriptionRu: 'Русское описание',
    substances: [
      {
        substanceId: '11111111-1111-4111-8111-111111111111',
        strengthValue: 200,
        strengthUnit: 'mg' as MedicineRecord['substances'][number]['strengthUnit'],
      },
    ],
  }
  return { ...base, ...overrides }
}

function makeDetail(record: MedicineRecord, description: string | null): MedicineDetail {
  return { record, description, offers: [], hasAnalogs: false }
}

describe('toMedicineDetailDto (DTJ-095, SRS-CAT-049)', () => {
  it('1. возвращает все обязательные поля SRS-CAT-049', () => {
    const record = makeRecord()
    const dto = toMedicineDetailDto(makeDetail(record, 'итоговое описание'))

    expect(dto.id).toBe(record.id)
    expect(dto.tradeName).toBe('Nurofen')
    expect(dto.innName).toBe('Ibuprofen')
    expect(dto.dosageForm).toBe('tablet')
    expect(dto.dosageFormClass).toBe('tablet')
    expect(dto.dosageStrength).toBe('200 mg')
    expect(dto.manufacturerName).toBe('DoruTJ Pharma')
    expect(dto.manufacturerCountry).toBe('Tajikistan')
    expect(dto.controlCategory).toBe('none')
    expect(dto.isPrescriptionRequired).toBe(false)
    expect(dto.requiresColdChain).toBe(false)
    expect(dto.imageUrl).toBe('https://cdn.example/nurofen.png')
    expect(dto.description).toBe('итоговое описание')
    expect(dto.substances).toHaveLength(1)
    expect(dto.offers).toEqual([])
    expect(dto.hasAnalogs).toBe(false)
  })

  it('2. substances[] маппится с substanceId/strengthValue/strengthUnit', () => {
    const record = makeRecord()
    const dto = toMedicineDetailDto(makeDetail(record, null))
    const substance = dto.substances[0]
    expect(substance).toBeDefined()
    expect(substance?.substanceId).toBe(record.substances[0]?.substanceId)
    expect(substance?.strengthValue).toBe(200)
    expect(substance?.strengthUnit).toBe('mg')
  })

  it('3. imageUrl: null сохраняется (SRS-CAT-007: плейсхолдер рисует фронт по dosageFormClass)', () => {
    const record = makeRecord({ imageUrl: null })
    const dto = toMedicineDetailDto(makeDetail(record, null))
    expect(dto.imageUrl).toBeNull()
    expect(dto.dosageFormClass).toBe('tablet')
  })

  it('4. controlCategory строковый enum в БД-форме (prescription_only, не prescriptionOnly)', () => {
    const record = makeRecord({ controlCategory: ControlCategory.prescriptionOnly })
    const dto = toMedicineDetailDto(makeDetail(record, null))
    expect(dto.controlCategory).toBe('prescription_only')
  })

  it('5. offers: [] и hasAnalogs: false проходят как есть (TODO-стабы DTJ-101)', () => {
    const record = makeRecord()
    const dto = toMedicineDetailDto(makeDetail(record, null))
    expect(dto.offers).toEqual([])
    expect(dto.hasAnalogs).toBe(false)
  })

  it('6. description: null когда оба поля пусты', () => {
    const record = makeRecord({ descriptionTj: null, descriptionRu: null })
    const dto = toMedicineDetailDto(makeDetail(record, null))
    expect(dto.description).toBeNull()
  })
})