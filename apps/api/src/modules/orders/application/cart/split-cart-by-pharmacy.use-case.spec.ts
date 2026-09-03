import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SplitCartByPharmacyUseCase, type PricedCartLineItem } from './split-cart-by-pharmacy.use-case.js'

const PHARMACY_A = randomUUID()
const PHARMACY_B = randomUUID()

function makeItem(overrides: Partial<PricedCartLineItem> = {}): PricedCartLineItem {
  return {
    medicineId: randomUUID(),
    medicineTradeName: 'Тест-медикамент',
    pharmacyId: PHARMACY_A,
    pharmacyName: 'Аптека А',
    quantity: 1,
    unitPriceDiram: 100n,
    ...overrides,
  }
}

describe('SplitCartByPharmacyUseCase', () => {
  const useCase = new SplitCartByPharmacyUseCase()

  it('пустой список — не падает, возвращает []', () => {
    expect(useCase.execute([])).toEqual([])
  })

  it('1 аптека — ровно 1 группа, subtotal = Σ(unitPrice*quantity)', () => {
    const items = [
      makeItem({ unitPriceDiram: 100n, quantity: 2 }),
      makeItem({ unitPriceDiram: 300n, quantity: 1 }),
    ]

    const groups = useCase.execute(items)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.pharmacyId).toBe(PHARMACY_A)
    expect(groups[0]?.subtotalDiram).toBe(500n) // 100*2 + 300*1
    expect(groups[0]?.items).toHaveLength(2)
    // DTJ-234 (дефект приёмки) — medicineTradeName проходит насквозь без изменений.
    expect(groups[0]?.items[0]?.medicineTradeName).toBe('Тест-медикамент')
  })

  it('AC4: N (2) аптек — ровно 2 группы, subtotal каждой группы корректен', () => {
    const items = [
      makeItem({ pharmacyId: PHARMACY_A, pharmacyName: 'Аптека А', unitPriceDiram: 100n, quantity: 2 }),
      makeItem({ pharmacyId: PHARMACY_B, pharmacyName: 'Аптека Б', unitPriceDiram: 250n, quantity: 3 }),
      makeItem({ pharmacyId: PHARMACY_A, pharmacyName: 'Аптека А', unitPriceDiram: 50n, quantity: 1 }),
    ]

    const groups = useCase.execute(items)

    expect(groups).toHaveLength(2)
    const groupA = groups.find((g) => g.pharmacyId === PHARMACY_A)
    const groupB = groups.find((g) => g.pharmacyId === PHARMACY_B)
    expect(groupA?.subtotalDiram).toBe(250n) // 100*2 + 50*1
    expect(groupA?.items).toHaveLength(2)
    expect(groupB?.subtotalDiram).toBe(750n) // 250*3
    expect(groupB?.items).toHaveLength(1)
  })

  it('distanceMeters отсутствует на выходе use case (заполняется presentation-слоем)', () => {
    const groups = useCase.execute([makeItem()])
    expect(groups[0]?.distanceMeters).toBeUndefined()
  })

  it('DTJ-225 (доработка по замечанию CTO): pharmacyName=null пропускается насквозь, НЕ подставляется pharmacyId', () => {
    const groups = useCase.execute([makeItem({ pharmacyName: null })])

    expect(groups[0]?.pharmacyName).toBeNull()
    expect(groups[0]?.pharmacyName).not.toBe(PHARMACY_A)
  })
})
