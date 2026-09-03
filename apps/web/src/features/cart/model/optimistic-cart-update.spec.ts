import { describe, expect, it } from 'vitest'
import type { CartView } from '../api/cart.api'
import { applyCartItemQuantityLocally, removeCartItemLocally } from './optimistic-cart-update'

/** `optimistic-cart-update.spec.ts` (DTJ-234) — чистые функции, без React. */

const CART: CartView = {
  items: [
    {
      id: 'item-1',
      cartId: 'c1',
      medicineId: 'm1',
      medicineTradeName: 'Медикамент 1',
      pharmacyId: 'p1',
      pharmacyName: 'Аптека 1',
      quantity: 2,
      priceDiram: 500,
      availableQuantity: 5,
      addedAt: 'x',
    },
    {
      id: 'item-2',
      cartId: 'c1',
      medicineId: 'm2',
      medicineTradeName: 'Медикамент 2',
      pharmacyId: 'p1',
      pharmacyName: 'Аптека 1',
      quantity: 1,
      priceDiram: 300,
      availableQuantity: 5,
      addedAt: 'x',
    },
    {
      id: 'item-3',
      cartId: 'c1',
      medicineId: 'm3',
      medicineTradeName: 'Медикамент 3',
      pharmacyId: 'p2',
      pharmacyName: 'Аптека 2',
      quantity: 1,
      priceDiram: 900,
      availableQuantity: 5,
      addedAt: 'x',
    },
  ],
  pharmacyGroups: [
    { pharmacyId: 'p1', pharmacyName: 'Аптека 1', items: [], subtotalDiram: 1300 },
    { pharmacyId: 'p2', pharmacyName: 'Аптека 2', items: [], subtotalDiram: 900 },
  ],
  warnings: [{ cartItemId: 'item-1', type: 'insufficient_stock', availableQuantity: 1 }],
}

describe('applyCartItemQuantityLocally (DTJ-234)', () => {
  it('1. увеличивает quantity строки и добавляет разницу к subtotalDiram нужной группы (целые дирамы)', () => {
    const next = applyCartItemQuantityLocally(CART, 'item-1', 4)
    expect(next.items.find((item) => item.id === 'item-1')?.quantity).toBe(4)
    // (4-2) * 500 = 1000 добавляется к 1300 => 2300
    expect(next.pharmacyGroups.find((group) => group.pharmacyId === 'p1')?.subtotalDiram).toBe(2300)
    // Группа p2 не затронута.
    expect(next.pharmacyGroups.find((group) => group.pharmacyId === 'p2')?.subtotalDiram).toBe(900)
  })

  it('2. уменьшает quantity строки и вычитает разницу из subtotalDiram', () => {
    const next = applyCartItemQuantityLocally(CART, 'item-1', 1)
    expect(next.items.find((item) => item.id === 'item-1')?.quantity).toBe(1)
    // (1-2) * 500 = -500 => 1300 - 500 = 800
    expect(next.pharmacyGroups.find((group) => group.pharmacyId === 'p1')?.subtotalDiram).toBe(800)
  })

  it('3. quantity <= 0 удаляет строку из items и НЕ удаляет группу, если в ней остались другие строки', () => {
    const next = applyCartItemQuantityLocally(CART, 'item-1', 0)
    expect(next.items.map((item) => item.id)).toEqual(['item-2', 'item-3'])
    expect(next.pharmacyGroups.some((group) => group.pharmacyId === 'p1')).toBe(true)
  })

  it('4. удаление ПОСЛЕДНЕЙ строки группы удаляет саму группу целиком', () => {
    const next = applyCartItemQuantityLocally(CART, 'item-3', 0)
    expect(next.pharmacyGroups.map((group) => group.pharmacyId)).toEqual(['p1'])
  })

  it('5. удаление строки чистит связанные с ней warnings (по cartItemId)', () => {
    const next = removeCartItemLocally(CART, 'item-1')
    expect(next.warnings).toEqual([])
  })

  it('6. неизвестный cartItemId — no-op, возвращает исходный снимок как есть', () => {
    const next = applyCartItemQuantityLocally(CART, 'unknown-id', 5)
    expect(next).toBe(CART)
  })

  it('7. исходный CART не мутируется (readonly-безопасность)', () => {
    const originalQuantity = CART.items[0]?.quantity
    applyCartItemQuantityLocally(CART, 'item-1', 9)
    expect(CART.items[0]?.quantity).toBe(originalQuantity)
  })
})
