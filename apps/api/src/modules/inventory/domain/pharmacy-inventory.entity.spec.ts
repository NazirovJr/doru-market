/**
 * Тест `PharmacyInventory` aggregate (EP-05, DTJ-143).
 *
 * Покрывает SRS-DOM-018..024: FEFO-инвариант, просрочка, stale-фильтр.
 */
import { describe, expect, it } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { PharmacyInventory, type InventoryLotProps } from './pharmacy-inventory.entity.js'
import { fixedDate } from '../testing/fixed-dates.js'

const PHARMACY_ID = '22222222-2222-2222-2222-222222222222'
const MEDICINE_ID = '11111111-1111-1111-1111-111111111111'
const INVENTORY_ID = '33333333-3333-3333-3333-333333333333'
const FAR_FUTURE_ISO = '2030-12-31'
const NEAR_FUTURE_ISO = '2027-06-01'
const PAST_ISO = '2020-01-01'
const TODAY = fixedDate('2026-01-15T00:00:00.000Z')

function lot(overrides: Partial<InventoryLotProps> = {}): InventoryLotProps {
  return {
    batchNumber: 'LOT-001',
    priceDiram: 15000n,
    quantity: 10,
    expiryDateIso: FAR_FUTURE_ISO,
    lastSyncedAt: fixedDate('2026-01-10T00:00:00.000Z'),
    ...overrides,
  }
}

describe('PharmacyInventory (DTJ-143, SRS-DOM-018..024)', () => {
  describe('create', () => {
    it('создаёт агрегат с пустым набором лотов', () => {
      const result = PharmacyInventory.create({
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
      })
      expect(result.ok).toBe(true)
      if (isOk(result)) {
        expect(result.value.stockQuantity(TODAY)).toBe(0)
        expect(result.value.getFefoLot(TODAY)).toBeNull()
      }
    })

    it('отклоняет пустой id', () => {
      const result = PharmacyInventory.create({
        id: '   ',
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
      })
      expect(result.ok).toBe(false)
    })

    it('отклоняет отрицательный quantity у лота', () => {
      const result = PharmacyInventory.create({
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
        initialLots: [lot({ quantity: -1 })],
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('stockQuantity (SRS-DOM-019)', () => {
    it('суммирует только продаваемые лоты (quantity > 0 AND expiryDate > today)', () => {
      const result = PharmacyInventory.create({
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
        initialLots: [
          lot({ batchNumber: 'A', quantity: 5, expiryDateIso: FAR_FUTURE_ISO }),
          lot({ batchNumber: 'B', quantity: 3, expiryDateIso: NEAR_FUTURE_ISO }),
          lot({ batchNumber: 'C', quantity: 7, expiryDateIso: PAST_ISO }),
          lot({ batchNumber: 'D', quantity: 0, expiryDateIso: FAR_FUTURE_ISO }),
        ],
      })
      expect(result.ok).toBe(true)
      if (isOk(result)) {
        // 5 + 3 = 8 (C — просрочен, D — 0).
        expect(result.value.stockQuantity(TODAY)).toBe(8)
      }
    })
  })

  describe('getFefoLot (SRS-DOM-020)', () => {
    it('возвращает лот с минимальным expiryDate среди продаваемых', () => {
      const result = PharmacyInventory.create({
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
        initialLots: [
          lot({ batchNumber: 'A', expiryDateIso: FAR_FUTURE_ISO, quantity: 5 }),
          lot({ batchNumber: 'B', expiryDateIso: NEAR_FUTURE_ISO, quantity: 3 }),
        ],
      })
      expect(result.ok).toBe(true)
      if (isOk(result)) {
        const fefo = result.value.getFefoLot(TODAY)
        expect(fefo).not.toBeNull()
        expect(fefo?.batchNumber).toBe('B')
        expect(fefo?.expiryDate.isoDate).toBe(NEAR_FUTURE_ISO)
      }
    })

    it('возвращает null, если только просроченные лоты', () => {
      const result = PharmacyInventory.create({
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
        initialLots: [lot({ expiryDateIso: PAST_ISO, quantity: 5 })],
      })
      expect(result.ok).toBe(true)
      if (isOk(result)) {
        expect(result.value.getFefoLot(TODAY)).toBeNull()
      }
    })

    it('возвращает null, если все лоты с quantity = 0', () => {
      const result = PharmacyInventory.create({
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
        initialLots: [lot({ quantity: 0 })],
      })
      expect(result.ok).toBe(true)
      if (isOk(result)) {
        expect(result.value.getFefoLot(TODAY)).toBeNull()
      }
    })
  })

  describe('applyDelta (SRS-DOM-024)', () => {
    it('добавляет новый лот, если batchNumber не существует', () => {
      const result = PharmacyInventory.create({
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
        initialLots: [lot({ batchNumber: 'A', quantity: 5 })],
      })
      expect(result.ok).toBe(true)
      if (!isOk(result)) return
      const aggregate = result.value
      const applyResult = aggregate.applyDelta(lot({ batchNumber: 'B', quantity: 7 }))
      expect(applyResult.applied).toBe(true)
      if (applyResult.applied) {
        expect(applyResult.lot.batchNumber).toBe('B')
      }
      expect(aggregate.getLots().length).toBe(2)
    })

    it('обновляет существующий лот, если syncTimestamp свежее', () => {
      const initial = lot({ batchNumber: 'A', quantity: 5, lastSyncedAt: fixedDate('2026-01-10') })
      const result = PharmacyInventory.create({
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
        initialLots: [initial],
      })
      expect(result.ok).toBe(true)
      if (!isOk(result)) return
      const aggregate = result.value
      const newer = lot({
        batchNumber: 'A',
        quantity: 9,
        lastSyncedAt: fixedDate('2026-01-20'),
      })
      const applyResult = aggregate.applyDelta(newer)
      expect(applyResult.applied).toBe(true)
      expect(aggregate.getLots().length).toBe(1)
      expect(aggregate.stockQuantity(TODAY)).toBe(9)
    })

    it('отбрасывает stale-обновление (syncTimestamp <= existing.lastSyncedAt)', () => {
      const initial = lot({ batchNumber: 'A', quantity: 5, lastSyncedAt: fixedDate('2026-01-20') })
      const result = PharmacyInventory.create({
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
        initialLots: [initial],
      })
      expect(result.ok).toBe(true)
      if (!isOk(result)) return
      const aggregate = result.value
      const stale = lot({
        batchNumber: 'A',
        quantity: 99,
        lastSyncedAt: fixedDate('2026-01-10'),
      })
      const applyResult = aggregate.applyDelta(stale)
      expect(applyResult.applied).toBe(false)
      if (!applyResult.applied) {
        expect(applyResult.reason).toBe('stale')
      }
      expect(aggregate.getLots().length).toBe(1)
      expect(aggregate.stockQuantity(TODAY)).toBe(5)
    })

    it('нормализует null batchNumber как один FEFO-ключ (без конфликта с пустой строкой)', () => {
      const result = PharmacyInventory.create({
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
        initialLots: [lot({ batchNumber: null, quantity: 5 })],
      })
      expect(result.ok).toBe(true)
      if (!isOk(result)) return
      const aggregate = result.value
      // `lastSyncedAt` ОБЯЗАН быть позже начального лота (`applyDelta`
      // отклоняет `incoming.lastSyncedAt <= existing.lastSyncedAt` как
      // 'stale', SRS-DOM-024) — `lot()` по умолчанию даёт ОДИНАКОВОЕ время
      // для обоих вызовов в этом тесте, что без явного override приводило
      // к ложному 'stale' и маскировало настоящую цель теста (нормализацию
      // FEFO-ключа для `batchNumber: null`).
      const second = lot({ batchNumber: null, quantity: 11, lastSyncedAt: fixedDate('2026-01-11T00:00:00.000Z') })
      const applyResult = aggregate.applyDelta(second)
      expect(applyResult.applied).toBe(true)
      expect(aggregate.getLots().length).toBe(1)
      expect(aggregate.stockQuantity(TODAY)).toBe(11)
    })
  })

  describe('restore (без повторной валидации, доверяет БД)', () => {
    it('создаёт агрегат из snapshot', () => {
      const snapshot = {
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
        lots: [lot({ batchNumber: 'A', quantity: 5 })],
      }
      const result = PharmacyInventory.restore(snapshot)
      expect(result.ok).toBe(true)
      if (isOk(result)) {
        expect(result.value.stockQuantity(TODAY)).toBe(5)
      }
    })
  })

  describe('toSnapshot', () => {
    it('возвращает полный снимок для репозитория', () => {
      const result = PharmacyInventory.create({
        id: INVENTORY_ID,
        pharmacyId: PHARMACY_ID,
        medicineId: MEDICINE_ID,
        initialLots: [lot({ batchNumber: 'A', quantity: 5 }), lot({ batchNumber: 'B', quantity: 7 })],
      })
      expect(result.ok).toBe(true)
      if (isOk(result)) {
        const snapshot = result.value.toSnapshot()
        expect(snapshot.id).toBe(INVENTORY_ID)
        expect(snapshot.lots.length).toBe(2)
      }
    })
  })
})
