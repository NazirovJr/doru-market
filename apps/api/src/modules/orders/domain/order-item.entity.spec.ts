import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BusinessRuleViolationError, ItemAlreadyScannedError } from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { fixedDate } from '@/modules/orders/testing/fixtures/fixed-date.fixture.js'
import { OrderItem } from './order-item.entity.js'

/** `no-restricted-globals` запрещает голый `Date` в файлах `domain/**` (§2.6) — фикстура вне глоба. */
const ARBITRARY_SCAN_TIMESTAMP = fixedDate('2026-09-04T00:00:00.000Z')

function makeItem(): OrderItem {
  return OrderItem.create({
    id: randomUUID(),
    medicineId: randomUUID(),
    unitPrice: Money.fromDiram(10_000n),
    quantity: 2,
    commissionBps: 800,
    inventoryBatchId: randomUUID(),
  })
}

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

describe('OrderItem — терминал фармацевта (DTJ-302/303, EP-12 §A.3/A.4)', () => {
  it('новая позиция стартует pending, все поля сканирования — null', () => {
    const item = makeItem()
    expect(item.fulfillmentStatus).toBe('pending')
    expect(item.scannedBatchId).toBeNull()
    expect(item.scannedAt).toBeNull()
    expect(item.scannedBy).toBeNull()
    expect(item.scanMethod).toBeNull()
    expect(item.itemIssueReason).toBeNull()
  })

  it('assertPending() — не бросает, пока позиция pending', () => {
    const item = makeItem()
    expect(() => {
      item.assertPending()
    }).not.toThrow()
  })

  it('assertPending() — бросает ItemAlreadyScannedError, если позиция уже не pending', () => {
    const item = makeItem()
    item.markScannedOk({ scannedAt: ARBITRARY_SCAN_TIMESTAMP, scannedBy: 'user-1', scanMethod: 'camera' })
    expect(() => {
      item.assertPending()
    }).toThrow(ItemAlreadyScannedError)
  })

  it('markScannedOk() — устанавливает fulfillmentStatus/scannedBatchId=inventoryBatchId/scannedAt/scannedBy/scanMethod', () => {
    const item = makeItem()
    const originalBatchId = item.inventoryBatchId
    const scannedAt = fixedDate('2026-09-04T09:30:00.000Z')

    item.markScannedOk({ scannedAt, scannedBy: 'pharmacist-1', scanMethod: 'manual' })

    expect(item.fulfillmentStatus).toBe('scanned_ok')
    expect(item.scannedBatchId).toBe(originalBatchId)
    expect(item.scannedAt).toBe(scannedAt)
    expect(item.scannedBy).toBe('pharmacist-1')
    expect(item.scanMethod).toBe('manual')
  })

  it('markScannedOk() — повторный вызов бросает ItemAlreadyScannedError (SRS-PHT-013)', () => {
    const item = makeItem()
    item.markScannedOk({ scannedAt: ARBITRARY_SCAN_TIMESTAMP, scannedBy: 'u1', scanMethod: 'camera' })
    expect(() => {
      item.markScannedOk({ scannedAt: ARBITRARY_SCAN_TIMESTAMP, scannedBy: 'u2', scanMethod: 'manual' })
    }).toThrow(ItemAlreadyScannedError)
  })

  it('substituteBatch() — заменяет inventoryBatchId, пока позиция pending', () => {
    const item = makeItem()
    const newBatchId = randomUUID()
    item.substituteBatch(newBatchId)
    expect(item.inventoryBatchId).toBe(newBatchId)
  })

  it('substituteBatch() — после markScannedOk бросает ItemAlreadyScannedError', () => {
    const item = makeItem()
    item.markScannedOk({ scannedAt: ARBITRARY_SCAN_TIMESTAMP, scannedBy: 'u1', scanMethod: 'camera' })
    expect(() => {
      item.substituteBatch(randomUUID())
    }).toThrow(ItemAlreadyScannedError)
  })

  it('markUnavailable() — устанавливает fulfillmentStatus=unavailable/itemIssueReason (SRS-PHT-018)', () => {
    const item = makeItem()
    item.markUnavailable('out_of_stock')
    expect(item.fulfillmentStatus).toBe('unavailable')
    expect(item.itemIssueReason).toBe('out_of_stock')
  })

  it('markUnavailable() — на уже не-pending позиции бросает BusinessRuleViolationError (422, НЕ ItemAlreadyScannedError/409 — DTJ-303)', () => {
    const item = makeItem()
    item.markScannedOk({ scannedAt: ARBITRARY_SCAN_TIMESTAMP, scannedBy: 'u1', scanMethod: 'camera' })
    expect(() => {
      item.markUnavailable('damaged_packaging')
    }).toThrow(BusinessRuleViolationError)
  })
})
