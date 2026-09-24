import { ErrorCode, type ManualEntryRow } from '@dorutj/contracts'

export interface PointEditFormState {
  readonly medicineId: string | null
  readonly medicineLabel: string
  readonly priceTjs: string
  readonly quantity: string
  readonly expiryDate: string
  readonly batchNumber: string
}

export const INITIAL_POINT_EDIT_STATE: PointEditFormState = {
  medicineId: null,
  medicineLabel: '',
  priceTjs: '',
  quantity: '',
  expiryDate: '',
  batchNumber: '',
}

export interface PointEditFormErrors {
  readonly price: boolean
  readonly quantity: boolean
  readonly expiryDate: boolean
}

function parseNumber(raw: string): number | null {
  if (raw.trim().length === 0) {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** Схема contracts не отклоняет цену `<= 0` (ради частичного успеха батча), поэтому ловим здесь. */
export function isPriceValid(raw: string): boolean {
  const value = parseNumber(raw)
  return value !== null && value > 0
}

export function isQuantityValid(raw: string): boolean {
  const value = parseNumber(raw)
  return value !== null && Number.isInteger(value) && value >= 0
}

/** `todayIso` передаёт вызывающий — функция остаётся детерминированной в тестах. */
export function isExpiryDateValid(expiryDate: string, todayIso: string): boolean {
  return expiryDate.length > 0 && expiryDate >= todayIso
}

export function validatePointEditForm(state: PointEditFormState, todayIso: string): PointEditFormErrors {
  return {
    price: !isPriceValid(state.priceTjs),
    quantity: !isQuantityValid(state.quantity),
    expiryDate: !isExpiryDateValid(state.expiryDate, todayIso),
  }
}

export function isPointEditFormValid(state: PointEditFormState, todayIso: string): boolean {
  const errors = validatePointEditForm(state, todayIso)
  return state.medicineId !== null && !errors.price && !errors.quantity && !errors.expiryDate
}

export function buildManualEntryRow(state: PointEditFormState): ManualEntryRow {
  if (state.medicineId === null) {
    throw new Error('buildManualEntryRow: medicineId is required (call isPointEditFormValid first)')
  }
  const row: ManualEntryRow = {
    medicineId: state.medicineId,
    priceTjs: Number(state.priceTjs),
    quantity: Number(state.quantity),
    expiryDate: state.expiryDate,
    op: 'upsert',
  }
  const trimmedBatch = state.batchNumber.trim()
  return trimmedBatch.length > 0 ? { ...row, batchNumber: trimmedBatch } : row
}

export function formatMedicineLabel(tradeName: string, dosageForm: string, dosageStrength: string): string {
  return `${tradeName} (${dosageForm}, ${dosageStrength})`
}

// `HttpError.code` — string; сравнение string с enum запрещает no-unsafe-enum-comparison.
const INSUFFICIENT_ROLE_CODE: string = ErrorCode.INSUFFICIENT_ROLE

export function resolveManualEntryErrorKey(errorCode: string): string {
  return errorCode === INSUFFICIENT_ROLE_CODE
    ? 'pharmacy.inventory.point_edit.error_insufficient_role'
    : 'pharmacy.inventory.point_edit.error_generic'
}
