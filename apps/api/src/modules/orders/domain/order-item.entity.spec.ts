import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { OrderItem } from './order-item.entity.js'

describe('OrderItem (DTJ-221, SRS-DOM-008/009, SRS-ORD-021/022)', () => {
  it('totalPrice = unitPrice × quantity, platformFeeDiram считается ТОЛЬКО от totalPrice', () => {
    const item = OrderItem.create({
      id: randomUUID(),
      medicineId: randomUUID(),
      unitPrice: Money.fromDiram(10_000n),
      quantity: 2,
      commissionBps: 800,
      inventoryBatchId: randomUUID(),
    })
    expect(item.totalPrice.diram).toBe(20_000n)
    expect(item.platformFeeDiram).toBe(1_600n) // 20000 × 800 / 10000 = 1600, без остатка
  })

  it('банковское округление: 1.5 дирама → 2 (округление к чётному вверх)', () => {
    const item = OrderItem.create({
      id: randomUUID(),
      medicineId: randomUUID(),
      unitPrice: Money.fromDiram(100n),
      quantity: 3, // totalPrice = 300; 300 × 50 / 10000 = 1.5
      commissionBps: 50,
      inventoryBatchId: randomUUID(),
    })
    expect(item.platformFeeDiram).toBe(2n)
  })

  it('банковское округление: 0.5 дирама → 0 (округление к чётному вниз)', () => {
    const item = OrderItem.create({
      id: randomUUID(),
      medicineId: randomUUID(),
      unitPrice: Money.fromDiram(100n),
      quantity: 1, // totalPrice = 100; 100 × 50 / 10000 = 0.5
      commissionBps: 50,
      inventoryBatchId: randomUUID(),
    })
    expect(item.platformFeeDiram).toBe(0n)
  })

  it('банковское округление: остаток > половины дирама → округление вверх (не половинный случай)', () => {
    const item = OrderItem.create({
      id: randomUUID(),
      medicineId: randomUUID(),
      unitPrice: Money.fromDiram(100n),
      quantity: 1, // totalPrice = 100; 100 × 99 / 10000 = 0.99 → остаток 9900/10000 > половины
      commissionBps: 99,
      inventoryBatchId: randomUUID(),
    })
    expect(item.platformFeeDiram).toBe(1n) // округление 0.99 → 1
  })

  it('commissionBps вне [0, 10000] — программная ошибка вызывающего кода, бросает Error', () => {
    expect(() =>
      OrderItem.create({
        id: randomUUID(),
        medicineId: randomUUID(),
        unitPrice: Money.fromDiram(100n),
        quantity: 1,
        commissionBps: 10_001,
        inventoryBatchId: randomUUID(),
      }),
    ).toThrow('commissionBps must be an integer')
  })

  it('commissionBps/platformFeeDiram — readonly (компиляция запрещает мутацию, DoD DTJ-221)', () => {
    const item = OrderItem.create({
      id: randomUUID(),
      medicineId: randomUUID(),
      unitPrice: Money.fromDiram(100n),
      quantity: 1,
      commissionBps: 500,
      inventoryBatchId: randomUUID(),
    })
    // @ts-expect-error — commissionBps объявлен readonly, прямое присвоение — ошибка компиляции.
    item.commissionBps = 999
  })

  it('restore()/toSnapshot() — round-trip без повторной валидации', () => {
    const original = OrderItem.create({
      id: randomUUID(),
      medicineId: randomUUID(),
      unitPrice: Money.fromDiram(5_000n),
      quantity: 4,
      commissionBps: 1200,
      inventoryBatchId: randomUUID(),
    })
    const restored = OrderItem.restore(original.toSnapshot())
    expect(restored.toSnapshot()).toEqual(original.toSnapshot())
  })
})
