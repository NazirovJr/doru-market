import { describe, expect, it } from 'vitest'
import {
  INITIAL_POINT_EDIT_STATE,
  buildManualEntryRow,
  formatMedicineLabel,
  isExpiryDateValid,
  isPointEditFormValid,
  isPriceValid,
  isQuantityValid,
  resolveManualEntryErrorKey,
  validatePointEditForm,
  type PointEditFormState,
} from './manual-entry-form.model'

const TODAY_ISO = '2026-09-24'

function validState(overrides: Partial<PointEditFormState> = {}): PointEditFormState {
  return {
    medicineId: 'med-1',
    medicineLabel: 'Цитрамон (табл., 500 мг)',
    priceTjs: '15.5',
    quantity: '10',
    expiryDate: '2026-12-31',
    batchNumber: '',
    ...overrides,
  }
}

/** DTJ-167 тест-план: «валидация отклоняет цену <= 0». */
describe('isPriceValid (DTJ-167 критерий приёмки 3)', () => {
  it('отклоняет цену 0', () => {
    expect(isPriceValid('0')).toBe(false)
  })

  it('отклоняет отрицательную цену', () => {
    expect(isPriceValid('-5')).toBe(false)
  })

  it('отклоняет пустую строку', () => {
    expect(isPriceValid('')).toBe(false)
  })

  it('отклоняет нечисловой ввод', () => {
    expect(isPriceValid('abc')).toBe(false)
  })

  it('принимает положительную цену', () => {
    expect(isPriceValid('15.5')).toBe(true)
  })
})

/** DTJ-167 тест-план: «валидация отклоняет отрицательный остаток». */
describe('isQuantityValid', () => {
  it('отклоняет отрицательный остаток', () => {
    expect(isQuantityValid('-1')).toBe(false)
  })

  it('отклоняет дробный остаток', () => {
    expect(isQuantityValid('1.5')).toBe(false)
  })

  it('принимает ноль', () => {
    expect(isQuantityValid('0')).toBe(true)
  })

  it('принимает целое положительное число', () => {
    expect(isQuantityValid('42')).toBe(true)
  })
})

describe('isExpiryDateValid', () => {
  it('отклоняет дату в прошлом', () => {
    expect(isExpiryDateValid('2020-01-01', TODAY_ISO)).toBe(false)
  })

  it('принимает сегодняшнюю дату', () => {
    expect(isExpiryDateValid(TODAY_ISO, TODAY_ISO)).toBe(true)
  })

  it('принимает дату в будущем', () => {
    expect(isExpiryDateValid('2030-01-01', TODAY_ISO)).toBe(true)
  })

  it('отклоняет пустую строку', () => {
    expect(isExpiryDateValid('', TODAY_ISO)).toBe(false)
  })
})

/** DTJ-167 тест-план: «валидная форма проходит без ошибок». */
describe('validatePointEditForm / isPointEditFormValid', () => {
  it('валидная форма — без ошибок, форма валидна целиком', () => {
    const state = validState()
    expect(validatePointEditForm(state, TODAY_ISO)).toEqual({ price: false, quantity: false, expiryDate: false })
    expect(isPointEditFormValid(state, TODAY_ISO)).toBe(true)
  })

  it('без выбранного медикамента — форма невалидна целиком, даже если остальные поля верны', () => {
    const state = validState({ medicineId: null })
    expect(isPointEditFormValid(state, TODAY_ISO)).toBe(false)
  })

  it('INITIAL_POINT_EDIT_STATE — невалидно (пустая форма)', () => {
    expect(isPointEditFormValid(INITIAL_POINT_EDIT_STATE, TODAY_ISO)).toBe(false)
  })
})

describe('buildManualEntryRow', () => {
  it('строит строку с op=upsert, без batchNumber, если он пуст', () => {
    expect(buildManualEntryRow(validState())).toEqual({
      medicineId: 'med-1',
      priceTjs: 15.5,
      quantity: 10,
      expiryDate: '2026-12-31',
      op: 'upsert',
    })
  })

  it('включает batchNumber, обрезанный от пробелов, если он задан', () => {
    const row = buildManualEntryRow(validState({ batchNumber: '  B-100  ' }))
    expect(row.batchNumber).toBe('B-100')
  })

  it('бросает, если medicineId не выбран (программная ошибка вызывающего кода)', () => {
    expect(() => buildManualEntryRow(validState({ medicineId: null }))).toThrow()
  })
})

describe('formatMedicineLabel', () => {
  it('форматирует название + форму выпуска + дозировку', () => {
    expect(formatMedicineLabel('Цитрамон', 'табл.', '500 мг')).toBe('Цитрамон (табл., 500 мг)')
  })
})

/** DTJ-167 критерий приёмки 4: 403 INSUFFICIENT_ROLE → понятное сообщение, не сырой JSON. */
describe('resolveManualEntryErrorKey', () => {
  it('INSUFFICIENT_ROLE → ключ понятного сообщения об отсутствии прав', () => {
    expect(resolveManualEntryErrorKey('INSUFFICIENT_ROLE')).toBe('pharmacy.inventory.point_edit.error_insufficient_role')
  })

  it('любой другой код → общий ключ ошибки', () => {
    expect(resolveManualEntryErrorKey('VALIDATION_ERROR')).toBe('pharmacy.inventory.point_edit.error_generic')
    expect(resolveManualEntryErrorKey('UNKNOWN_ERROR')).toBe('pharmacy.inventory.point_edit.error_generic')
  })
})
