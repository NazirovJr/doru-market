import { describe, expect, it, vi } from 'vitest'
import type { TranslateFunction } from '@dorutj/i18n'
import type { CartPharmacyGroupDto } from '@dorutj/contracts'
import { checkoutFormReducer, createInitialCheckoutFormState } from './checkout-form.model'
import { buildCreateOrderInput } from './build-create-order-input'

const t: TranslateFunction = vi.fn((key: string) => key)
const CART_ITEM_IDS = ['item-1', 'item-2']
const PHARMACY_GROUPS: readonly CartPharmacyGroupDto[] = [
  { pharmacyId: 'pharm-1', pharmacyName: 'Аптека Салом', items: [], subtotalDiram: 5000 },
  { pharmacyId: 'pharm-2', pharmacyName: 'Аптека Файз', items: [], subtotalDiram: 3200 },
]

describe('buildCreateOrderInput', () => {
  it('returns null for an incomplete inline address (no coordinates picked yet)', () => {
    const state = checkoutFormReducer(createInitialCheckoutFormState(), {
      type: 'set_inline_address_text',
      value: 'ул. Рудаки, 12',
    })
    expect(buildCreateOrderInput({ state, cartItemIds: CART_ITEM_IDS, pharmacyGroups: PHARMACY_GROUPS }, t)).toBeNull()
  })

  it('builds a valid inline-address request body, with landmark folded into inlineAddress.landmarkText', () => {
    let state = createInitialCheckoutFormState()
    state = checkoutFormReducer(state, { type: 'set_inline_address_text', value: 'ул. Рудаки, 12' })
    state = checkoutFormReducer(state, { type: 'set_inline_coordinates', latitude: 38.55, longitude: 68.78 })
    state = checkoutFormReducer(state, { type: 'set_landmark', value: 'у мечети' })
    state = checkoutFormReducer(state, { type: 'set_entrance', value: '2' })

    const input = buildCreateOrderInput({ state, cartItemIds: CART_ITEM_IDS, pharmacyGroups: PHARMACY_GROUPS }, t)

    expect(input).not.toBeNull()
    expect(input?.cartItemIds).toEqual(CART_ITEM_IDS)
    expect(input?.deliveryAddressId).toBeNull()
    expect(input?.deliveryLandmark).toBeNull()
    expect(input?.inlineAddress).toMatchObject({
      addressText: 'ул. Рудаки, 12',
      latitude: 38.55,
      longitude: 68.78,
    })
    expect(input?.inlineAddress?.landmarkText).toContain('у мечети')
    expect(input?.paymentMethod).toBe('cash_courier')
  })

  it('returns null in saved mode without a chosen savedAddressId', () => {
    const state = { ...createInitialCheckoutFormState(), addressMode: 'saved' as const, savedAddressId: null }
    expect(buildCreateOrderInput({ state, cartItemIds: CART_ITEM_IDS, pharmacyGroups: PHARMACY_GROUPS }, t)).toBeNull()
  })

  it('builds a saved-address request body with landmark on the top-level deliveryLandmark field', () => {
    let state = checkoutFormReducer(createInitialCheckoutFormState(), {
      type: 'select_saved_address',
      addressId: 'addr-1',
    })
    state = checkoutFormReducer(state, { type: 'set_landmark', value: 'у мечети' })

    const input = buildCreateOrderInput({ state, cartItemIds: CART_ITEM_IDS, pharmacyGroups: PHARMACY_GROUPS }, t)

    expect(input).not.toBeNull()
    expect(input?.deliveryAddressId).toBe('addr-1')
    expect(input?.inlineAddress).toBeNull()
    expect(input?.deliveryLandmark).toContain('у мечети')
  })

  it('SRS-ORD-023 (поправка CTO волна 6) — expectedTotalDiramByPharmacy строится из pharmacyGroups.subtotalDiram, ключ pharmacyId, по КАЖДОЙ группе корзины', () => {
    let state = checkoutFormReducer(createInitialCheckoutFormState(), {
      type: 'select_saved_address',
      addressId: 'addr-1',
    })
    state = checkoutFormReducer(state, { type: 'set_landmark', value: 'у мечети' })

    const input = buildCreateOrderInput({ state, cartItemIds: CART_ITEM_IDS, pharmacyGroups: PHARMACY_GROUPS }, t)

    expect(input?.expectedTotalDiramByPharmacy).toEqual({ 'pharm-1': 5000, 'pharm-2': 3200 })
  })

  it('корзина одной аптеки — expectedTotalDiramByPharmacy содержит РОВНО одну запись (не подмешивает чужие группы)', () => {
    let state = checkoutFormReducer(createInitialCheckoutFormState(), {
      type: 'select_saved_address',
      addressId: 'addr-1',
    })
    state = checkoutFormReducer(state, { type: 'set_landmark', value: 'у мечети' })
    const singleGroup: readonly CartPharmacyGroupDto[] = [PHARMACY_GROUPS[0]!]

    const input = buildCreateOrderInput({ state, cartItemIds: CART_ITEM_IDS, pharmacyGroups: singleGroup }, t)

    expect(input?.expectedTotalDiramByPharmacy).toEqual({ 'pharm-1': 5000 })
  })
})
