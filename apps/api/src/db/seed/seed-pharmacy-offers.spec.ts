/**
 * Тесты чистых функций генерации остатков демо-стенда (`seed-pharmacy-offers.ts`).
 * Ноль I/O — только детерминизм, покрытие аналогов, диапазоны.
 */
import { describe, expect, it } from 'vitest'
import {
  buildOffersForMedicine,
  hashString,
  selectMedicinesForOffers,
  upsertOffersByPharmacy,
  type CatalogMedicineForOffers,
} from './seed-pharmacy-offers.js'
import type { PharmacyInventoryRepository, UpsertInput } from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'

const PHARMACY_POOL = ['ph-1', 'ph-2', 'ph-3', 'ph-4', 'ph-5', 'ph-6', 'ph-7']

function med(id: string, tradeName: string, substanceIds: readonly string[] = []): CatalogMedicineForOffers {
  return { id, tradeName, substanceIds }
}

describe('selectMedicinesForOffers', () => {
  it('приоритизирует медикаменты, входящие в аналоговую группу (⩾2 на substance)', () => {
    const medicines = [
      med('m1', 'Alpha', ['s1']),
      med('m2', 'Beta', ['s1']),
      med('m3', 'Gamma', ['s2']), // одиночный substance — не аналог
      med('m4', 'Delta'),
    ]
    const selected = selectMedicinesForOffers(medicines)
    const ids = selected.map((m) => m.id)
    // Аналоговая пара (m1, m2) должна оказаться раньше одиночек в списке покрытия.
    expect(ids.indexOf('m1')).toBeLessThan(ids.indexOf('m3'))
    expect(ids.indexOf('m2')).toBeLessThan(ids.indexOf('m4'))
    expect(ids).toHaveLength(4)
  })

  it('детерминирован: два вызова с одинаковым входом дают одинаковый порядок', () => {
    const medicines = Array.from({ length: 20 }, (_, i) => med(`id-${String(i)}`, `Trade${String(i)}`, [`s${String(i % 5)}`]))
    const a = selectMedicinesForOffers(medicines).map((m) => m.id)
    const b = selectMedicinesForOffers(medicines).map((m) => m.id)
    expect(a).toEqual(b)
  })
})

describe('buildOffersForMedicine', () => {
  it('генерирует 3..6 предложений у РАЗНЫХ аптек с РАЗНЫМИ ценами', () => {
    const medicine = med('paracetamol-1', 'Парацетамол 500мг')
    const offers = buildOffersForMedicine(medicine, PHARMACY_POOL, new Date('2026-01-01'))
    expect(offers.length).toBeGreaterThanOrEqual(3)
    expect(offers.length).toBeLessThanOrEqual(6)
    const pharmacyIds = new Set(offers.map((o) => o.pharmacyId))
    expect(pharmacyIds.size).toBe(offers.length) // без повторов аптек
    const prices = offers.map((o) => o.price)
    expect(new Set(prices).size).toBeGreaterThan(1) // разброс цен, не одна цена
    for (const price of prices) {
      expect(Number.isInteger(price)).toBe(true) // целые дирамы (AGENTS.md §6)
      expect(price).toBeGreaterThan(0)
    }
  })

  it('детерминирован по medicineId: повторный вызов даёт идентичный результат', () => {
    const medicine = med('ibuprofen-1', 'Ибупрофен 400мг')
    const now = new Date('2026-01-01')
    const a = buildOffersForMedicine(medicine, PHARMACY_POOL, now)
    const b = buildOffersForMedicine(medicine, PHARMACY_POOL, now)
    expect(a).toEqual(b)
  })

  it('срок годности всегда в будущем относительно now', () => {
    const now = new Date('2026-01-01')
    const medicine = med('x', 'X')
    const offers = buildOffersForMedicine(medicine, PHARMACY_POOL, now)
    for (const offer of offers) {
      expect(new Date(offer.expiresAtIso).getTime()).toBeGreaterThan(now.getTime())
    }
  })
})

describe('hashString', () => {
  it('стабилен для одной и той же строки', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
  })
  it('различает разные строки (не всегда, но для этого набора — да)', () => {
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})

describe('upsertOffersByPharmacy', () => {
  it('группирует по аптеке и вызывает upsertMany один раз на аптеку', async () => {
    const calls: UpsertInput[] = []
    const fakeRepo: PharmacyInventoryRepository = {
      upsertMany: (input) => {
        calls.push(input)
        return Promise.resolve({ acceptedCount: input.rows.length, updatedCount: 0 })
      },
      findOrCreateManyByMedicineIds: () => Promise.resolve(new Map()),
      saveMany: () => Promise.resolve(),
    }
    const now = new Date('2026-01-01')
    const offers = [
      ...buildOffersForMedicine(med('m1', 'Med1'), PHARMACY_POOL, now),
      ...buildOffersForMedicine(med('m2', 'Med2'), PHARMACY_POOL, now),
    ]
    const total = await upsertOffersByPharmacy(fakeRepo, offers, now)
    expect(total).toBe(offers.length)
    const pharmaciesTouched = new Set(calls.map((c) => c.pharmacyId))
    expect(calls).toHaveLength(pharmaciesTouched.size) // один вызов на аптеку
  })
})
