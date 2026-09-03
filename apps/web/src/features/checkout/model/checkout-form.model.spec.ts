import { describe, expect, it } from 'vitest'
import {
  ENABLED_PAYMENT_METHODS_R1,
  checkoutFormReducer,
  createInitialCheckoutFormState,
  isCheckoutFormValid,
  validateCheckoutForm,
  type CheckoutFormState,
} from './checkout-form.model'

/**
 * `checkout-form.model.spec.ts` (DTJ-235, тест-план: «model/checkout-form.model.ts — валидация
 * полей адреса/ориентира как чистые функции»).
 */
describe('createInitialCheckoutFormState', () => {
  it('defaults to inline address mode and cash_courier (R1: единственный доступный путь)', () => {
    const state = createInitialCheckoutFormState()
    expect(state.addressMode).toBe('inline')
    expect(state.paymentMethod).toBe('cash_courier')
    expect(state.inlineAddress).toEqual({ addressText: '', latitude: null, longitude: null })
  })
})

describe('checkoutFormReducer', () => {
  const initial = createInitialCheckoutFormState()

  it('set_inline_address_text updates only the address text field', () => {
    const next = checkoutFormReducer(initial, { type: 'set_inline_address_text', value: 'ул. Рудаки, 12' })
    expect(next.inlineAddress.addressText).toBe('ул. Рудаки, 12')
    expect(next.inlineAddress.latitude).toBeNull()
  })

  it('set_inline_coordinates updates lat/lon together', () => {
    const next = checkoutFormReducer(initial, { type: 'set_inline_coordinates', latitude: 38.55, longitude: 68.78 })
    expect(next.inlineAddress.latitude).toBe(38.55)
    expect(next.inlineAddress.longitude).toBe(68.78)
  })

  it('select_saved_address switches mode to saved and stores the id', () => {
    const next = checkoutFormReducer(initial, { type: 'select_saved_address', addressId: 'addr-1' })
    expect(next.addressMode).toBe('saved')
    expect(next.savedAddressId).toBe('addr-1')
  })

  it('switch_to_inline_address returns the SAME object when already inline (no-op)', () => {
    const next = checkoutFormReducer(initial, { type: 'switch_to_inline_address' })
    expect(next).toBe(initial)
  })

  it('switch_to_inline_address clears savedAddressId when coming from saved mode', () => {
    const saved = checkoutFormReducer(initial, { type: 'select_saved_address', addressId: 'addr-1' })
    const next = checkoutFormReducer(saved, { type: 'switch_to_inline_address' })
    expect(next.addressMode).toBe('inline')
    expect(next.savedAddressId).toBeNull()
  })

  it('set_landmark/set_entrance/set_floor/set_apartment update their own field only', () => {
    const withLandmark = checkoutFormReducer(initial, { type: 'set_landmark', value: 'у мечети' })
    const withEntrance = checkoutFormReducer(withLandmark, { type: 'set_entrance', value: '2' })
    const withFloor = checkoutFormReducer(withEntrance, { type: 'set_floor', value: '5' })
    const finalState = checkoutFormReducer(withFloor, { type: 'set_apartment', value: '34' })
    expect(finalState).toMatchObject({ landmark: 'у мечети', entrance: '2', floor: '5', apartment: '34' })
  })

  it('set_payment_method accepts an enabled method (cash_courier)', () => {
    const next = checkoutFormReducer(initial, { type: 'set_payment_method', method: 'cash_courier' })
    expect(next.paymentMethod).toBe('cash_courier')
  })

  it('set_payment_method REJECTS a disabled method (R1 hard-coded rule, AC4) and returns the SAME object', () => {
    const next = checkoutFormReducer(initial, { type: 'set_payment_method', method: 'alif_mobi' })
    expect(next).toBe(initial)
    expect(next.paymentMethod).toBe('cash_courier')
  })

  it('ENABLED_PAYMENT_METHODS_R1 contains only cash_courier (D-16/D-25)', () => {
    expect(ENABLED_PAYMENT_METHODS_R1).toEqual(['cash_courier'])
  })
})

describe('validateCheckoutForm', () => {
  it('requires addressText and coordinates in inline mode when both are empty', () => {
    const state = createInitialCheckoutFormState()
    const validation = validateCheckoutForm(state)
    expect(validation).toEqual({ addressText: 'required', coordinates: 'required' })
    expect(isCheckoutFormValid(validation)).toBe(false)
  })

  it('passes in inline mode once addressText and coordinates are both set', () => {
    let state = createInitialCheckoutFormState()
    state = checkoutFormReducer(state, { type: 'set_inline_address_text', value: 'ул. Рудаки, 12' })
    state = checkoutFormReducer(state, { type: 'set_inline_coordinates', latitude: 38.55, longitude: 68.78 })
    const validation = validateCheckoutForm(state)
    expect(validation).toEqual({})
    expect(isCheckoutFormValid(validation)).toBe(true)
  })

  it('requires savedAddressId in saved mode', () => {
    const state: CheckoutFormState = { ...createInitialCheckoutFormState(), addressMode: 'saved', savedAddressId: null }
    expect(validateCheckoutForm(state)).toEqual({ savedAddress: 'required' })
  })

  it('passes in saved mode once savedAddressId is set', () => {
    const state = checkoutFormReducer(createInitialCheckoutFormState(), {
      type: 'select_saved_address',
      addressId: 'addr-1',
    })
    expect(validateCheckoutForm(state)).toEqual({})
  })

  it('ignores entrance/floor/apartment/landmark for validity (optional fields)', () => {
    let state = createInitialCheckoutFormState()
    state = checkoutFormReducer(state, { type: 'set_inline_address_text', value: 'ул. Рудаки, 12' })
    state = checkoutFormReducer(state, { type: 'set_inline_coordinates', latitude: 38.55, longitude: 68.78 })
    expect(isCheckoutFormValid(validateCheckoutForm(state))).toBe(true)
  })
})
