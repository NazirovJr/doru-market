import type { OrderPaymentMethod } from '@dorutj/contracts'

/**
 * `checkout-form.model.ts` (DTJ-235, EP-09, «Что сделать» §2/8, `SRS-UX-054`) — ЧИСТОЕ состояние
 * формы checkout: типы, дефолт, reducer, валидаторы. Ноль импортов React/`@dorutj/i18n` (SRS-UX-054:
 * состояние формы обязано пережить переключение локали — переключатель языка меняет ТОЛЬКО
 * словарь `useT()`, эта модель про него вообще не знает, поэтому смена локали физически не может
 * задеть значения полей). React-обвязка (`useReducer`, синхронный мьютекс двойного клика) —
 * `use-checkout-form.ts` в этой же папке (тот же приём разделения «чистая логика / hook», что
 * `optimistic-cart-update.ts` vs `use-cart-mutations.ts` в `features/cart`).
 *
 * **Способы оплаты в R1 (D-16/D-25).** `ENABLED_PAYMENT_METHODS_R1` — ЖЁСТКИЙ список ПРЯМО В
 * КОДЕ (тикет «Что сделать» §4: «состояние disabled ЖЁСТКО в коде для R1, не зависит от
 * бэкенд-флага, который может быть недоступен» — тот же риск, что `DTJ-229` «Риски»:
 * `tenant_settings.enabled_payment_methods` может быть недоступно бэкенду). `setPaymentMethod`
 * (reducer-ветка) отбрасывает попытку выбрать НЕ входящий в список метод — ВТОРОЙ рубеж защиты
 * поверх `disabled`-атрибута кнопки в `PaymentMethodSection` (AC4: «клик по ним ничего не
 * отправляет» проверяется и на уровне DOM, и на уровне чистой функции).
 */

export const ENABLED_PAYMENT_METHODS_R1: readonly OrderPaymentMethod[] = ['cash_courier']
const DEFAULT_PAYMENT_METHOD: OrderPaymentMethod = 'cash_courier'

export type CheckoutAddressMode = 'saved' | 'inline'

export interface CheckoutInlineAddressFields {
  readonly addressText: string
  readonly latitude: number | null
  readonly longitude: number | null
}

export interface CheckoutFormState {
  readonly addressMode: CheckoutAddressMode
  readonly savedAddressId: string | null
  readonly inlineAddress: CheckoutInlineAddressFields
  readonly landmark: string
  readonly entrance: string
  readonly floor: string
  readonly apartment: string
  readonly paymentMethod: OrderPaymentMethod
}

export function createInitialCheckoutFormState(): CheckoutFormState {
  return {
    // Нет эндпоинта списка сохранённых адресов (см. отчёт сдачи, раздел ДОПУЩЕНИЯ) — единственный
    // рабочий режим сегодня — инлайн-ввод, дефолт `'inline'` отражает это честно.
    addressMode: 'inline',
    savedAddressId: null,
    inlineAddress: { addressText: '', latitude: null, longitude: null },
    landmark: '',
    entrance: '',
    floor: '',
    apartment: '',
    paymentMethod: DEFAULT_PAYMENT_METHOD,
  }
}

export type CheckoutFormAction =
  | { readonly type: 'select_saved_address'; readonly addressId: string }
  | { readonly type: 'switch_to_inline_address' }
  | { readonly type: 'set_inline_address_text'; readonly value: string }
  | { readonly type: 'set_inline_coordinates'; readonly latitude: number; readonly longitude: number }
  | { readonly type: 'set_landmark'; readonly value: string }
  | { readonly type: 'set_entrance'; readonly value: string }
  | { readonly type: 'set_floor'; readonly value: string }
  | { readonly type: 'set_apartment'; readonly value: string }
  | { readonly type: 'set_payment_method'; readonly method: OrderPaymentMethod }

function isEnabledPaymentMethod(method: OrderPaymentMethod): boolean {
  return ENABLED_PAYMENT_METHODS_R1.includes(method)
}

/** Вынесено из `checkoutFormReducer` (C3, `complexity` ≤10) — та же логика, отдельная функция. */
function switchToInlineAddress(state: CheckoutFormState): CheckoutFormState {
  if (state.addressMode === 'inline') {
    return state
  }
  return { ...state, addressMode: 'inline', savedAddressId: null }
}

/** Вынесено из `checkoutFormReducer` (C3, `complexity` ≤10) — см. JSDoc `isEnabledPaymentMethod`. */
function applyPaymentMethod(state: CheckoutFormState, method: OrderPaymentMethod): CheckoutFormState {
  if (!isEnabledPaymentMethod(method)) {
    return state
  }
  return { ...state, paymentMethod: method }
}

/**
 * Reducer возвращает ТОТ ЖЕ объект `state` (referential equality), когда действие фактически
 * ничего не меняет (например, клик по задизейбленному способу оплаты) — `use-checkout-form.ts`
 * читает это через `!==`, чтобы решить, «взорвался» ли `Idempotency-Key` предыдущей попытки
 * (тикет «Что сделать» §1: новый ключ — только при ЯВНОМ изменении данных формы).
 */
export function checkoutFormReducer(state: CheckoutFormState, action: CheckoutFormAction): CheckoutFormState {
  switch (action.type) {
    case 'select_saved_address':
      return { ...state, addressMode: 'saved', savedAddressId: action.addressId }
    case 'switch_to_inline_address':
      return switchToInlineAddress(state)
    case 'set_inline_address_text':
      return { ...state, inlineAddress: { ...state.inlineAddress, addressText: action.value } }
    case 'set_inline_coordinates':
      return {
        ...state,
        inlineAddress: { ...state.inlineAddress, latitude: action.latitude, longitude: action.longitude },
      }
    case 'set_landmark':
      return { ...state, landmark: action.value }
    case 'set_entrance':
      return { ...state, entrance: action.value }
    case 'set_floor':
      return { ...state, floor: action.value }
    case 'set_apartment':
      return { ...state, apartment: action.value }
    case 'set_payment_method':
      return applyPaymentMethod(state, action.method)
  }
}

export type CheckoutFieldError = 'required'

export interface CheckoutFormValidation {
  readonly addressText?: CheckoutFieldError
  readonly coordinates?: CheckoutFieldError
  readonly savedAddress?: CheckoutFieldError
}

/** Пара «валидация полей адреса/ориентира как чистые функции» — тест-план тикета. */
export function validateCheckoutForm(state: CheckoutFormState): CheckoutFormValidation {
  if (state.addressMode === 'saved') {
    return state.savedAddressId === null ? { savedAddress: 'required' } : {}
  }
  const errors: { addressText?: CheckoutFieldError; coordinates?: CheckoutFieldError } = {}
  if (state.inlineAddress.addressText.trim().length === 0) {
    errors.addressText = 'required'
  }
  if (state.inlineAddress.latitude === null || state.inlineAddress.longitude === null) {
    errors.coordinates = 'required'
  }
  return errors
}

export function isCheckoutFormValid(validation: CheckoutFormValidation): boolean {
  return Object.keys(validation).length === 0
}
