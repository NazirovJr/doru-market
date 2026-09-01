/**
 * Тест `InventoryBatchUpsertRow` (DTJ-145, EP-05) — фиксирует валидацию VO.
 */
import { describe, expect, it } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { InventoryBatchUpsertRow } from './inventory-batch-upsert-row.vo.js'

const FUTURE_DATE_ISO = '2030-01-01'
const PAST_DATE_ISO = '2020-01-01'
// eslint-disable-next-line no-restricted-globals -- `now: Date` — параметр доменного метода по контракту (`02` §2.6).
const NOW = new Date('2026-01-01T00:00:00.000Z')

describe('InventoryBatchUpsertRow (DTJ-145, SRS-INV-002)', () => {
  it('создаёт валидную строку', () => {
    const result = InventoryBatchUpsertRow.create(
      {
        medicineId: '11111111-1111-1111-1111-111111111111',
        barcode: null,
        price: 15000,
        quantity: 10,
        expiresAt: FUTURE_DATE_ISO,
        batchNumber: 'LOT-001',
      },
      NOW,
    )
    expect(result.ok).toBe(true)
    if (isOk(result)) {
      expect(result.value.getPrice()).toBe(15000)
      expect(result.value.getQuantity()).toBe(10)
    }
  })

  it('отклоняет отрицательную цену (J7, money >= 0)', () => {
    const result = InventoryBatchUpsertRow.create(
      {
        medicineId: '11111111-1111-1111-1111-111111111111',
        barcode: null,
        price: -1,
        quantity: 0,
        expiresAt: FUTURE_DATE_ISO,
        batchNumber: null,
      },
      NOW,
    )
    expect(result.ok).toBe(false)
  })

  it('отклоняет дробную цену (J7, money — integer dirams)', () => {
    const result = InventoryBatchUpsertRow.create(
      {
        medicineId: '11111111-1111-1111-1111-111111111111',
        barcode: null,
        price: 1.5,
        quantity: 0,
        expiresAt: FUTURE_DATE_ISO,
        batchNumber: null,
      },
      NOW,
    )
    expect(result.ok).toBe(false)
  })

  it('отклоняет expiresAt в прошлом (FEFO-инвариант)', () => {
    const result = InventoryBatchUpsertRow.create(
      {
        medicineId: '11111111-1111-1111-1111-111111111111',
        barcode: null,
        price: 100,
        quantity: 0,
        expiresAt: PAST_DATE_ISO,
        batchNumber: null,
      },
      NOW,
    )
    expect(result.ok).toBe(false)
  })

  it('отклоняет пустой medicineId', () => {
    const result = InventoryBatchUpsertRow.create(
      {
        medicineId: '',
        barcode: null,
        price: 100,
        quantity: 0,
        expiresAt: FUTURE_DATE_ISO,
        batchNumber: null,
      },
      NOW,
    )
    expect(result.ok).toBe(false)
  })

  it('quantity=0 допустим (нет в наличии)', () => {
    const result = InventoryBatchUpsertRow.create(
      {
        medicineId: '11111111-1111-1111-1111-111111111111',
        barcode: null,
        price: 100,
        quantity: 0,
        expiresAt: FUTURE_DATE_ISO,
        batchNumber: null,
      },
      NOW,
    )
    expect(result.ok).toBe(true)
  })
})
