import { ErrorCode, type ManualEntryRow } from '@dorutj/contracts'

/**
 * `manual-entry-form.model.ts` (DTJ-167, EP-05, SRS-INV-015/016) — чистые функции формы
 * точечного редактирования остатка. БЕЗ React (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §5:
 * вычисления/ветвления правил — в `model/`, не в компоненте).
 *
 * Все проверки ниже — клиентская UX-подсказка (быстрая обратная связь, критерий приёмки 3).
 * Финальная валидация всё равно на backend: `manualEntryRowSchema` (`@dorutj/contracts`,
 * `packages/contracts/src/inventory/manual-entry.schema.ts`) НЕ отклоняет `priceTjs<=0` на
 * уровне схемы (см. её JSDoc — намеренно, ради частичного успеха батч-канала), поэтому клиентская
 * проверка `isPriceValid` здесь — единственное место, где пользователь узнаёт об ошибке ДО
 * бесполезного запроса к API (критерий приёмки 3).
 */

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

/** Критерий приёмки 3: цена `<= 0` отклоняется ДО отправки. */
export function isPriceValid(raw: string): boolean {
  const value = parseNumber(raw)
  return value !== null && value > 0
}

export function isQuantityValid(raw: string): boolean {
  const value = parseNumber(raw)
  return value !== null && Number.isInteger(value) && value >= 0
}

/**
 * `todayIso` (`YYYY-MM-DD`) передаётся вызывающим компонентом — чистая функция не читает
 * `Date.now()`/`new Date()` сама, чтобы оставаться детерминированной в unit-тестах (тот же дух,
 * что порт `Clock` в backend `domain/`, хоть это правило Ж8 формально про backend).
 */
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

/** `state.medicineId` обязан быть непустым (проверено `isPointEditFormValid` до вызова) — иначе программная ошибка вызывающего кода. */
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

/** Отображаемая подпись автокомплита: `tradeName` + форма/дозировка — различение похожих позиций (критерий приёмки 1). */
export function formatMedicineLabel(tradeName: string, dosageForm: string, dosageStrength: string): string {
  return `${tradeName} (${dosageForm}, ${dosageStrength})`
}

/**
 * `INSUFFICIENT_ROLE_CODE: string` (не прямое сравнение со значением enum) — `HttpError.code`
 * (`shared/api/http-client.ts`) типизирован как `string` (реальный код с сервера не обязан быть
 * валидным `ErrorCode`, тот же довод, что `resolveHttpStatus` в backend `all-exceptions.filter.ts`),
 * прямое сравнение `string === ErrorCode` ловится `@typescript-eslint/no-unsafe-enum-comparison`.
 */
const INSUFFICIENT_ROLE_CODE: string = ErrorCode.INSUFFICIENT_ROLE

/** Критерий приёмки 4: `403 INSUFFICIENT_ROLE` → понятный текст, не сырой JSON. */
export function resolveManualEntryErrorKey(errorCode: string): string {
  return errorCode === INSUFFICIENT_ROLE_CODE
    ? 'pharmacy.inventory.point_edit.error_insufficient_role'
    : 'pharmacy.inventory.point_edit.error_generic'
}
