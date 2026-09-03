import { describe, expect, it } from 'vitest'
import { groupCartWarnings, type CartWarning } from './group-warnings'

/**
 * `group-warnings.spec.ts` (DTJ-234). Чистая функция, без React — см. JSDoc `group-warnings.ts`
 * для обоснования формы (`byCartItemId` только для `insufficient_stock`, `cartLevel` для
 * `duplicate_substance`, продиктовано формой `@dorutj/contracts`, не додумано).
 */

const insufficientStock = (cartItemId: string, availableQuantity: number): CartWarning => ({
  cartItemId,
  type: 'insufficient_stock',
  availableQuantity,
})

const duplicateSubstance = (existingMedicineId: string, newMedicineId: string): CartWarning => ({
  type: 'duplicate_substance',
  existingMedicineId,
  existingMedicineTradeName: `Trade-${existingMedicineId}`,
  newMedicineId,
  newMedicineTradeName: `Trade-${newMedicineId}`,
  substanceNames: ['Ибупрофен'],
})

describe('groupCartWarnings (DTJ-234)', () => {
  it('1. пустой массив — пустые byCartItemId/cartLevel', () => {
    const result = groupCartWarnings([])
    expect(result.byCartItemId.size).toBe(0)
    expect(result.cartLevel).toEqual([])
  })

  it('2. insufficient_stock группируется по cartItemId', () => {
    const warnings = [insufficientStock('item-1', 2), insufficientStock('item-2', 0)]
    const result = groupCartWarnings(warnings)
    expect(result.byCartItemId.get('item-1')).toEqual([warnings[0]])
    expect(result.byCartItemId.get('item-2')).toEqual([warnings[1]])
    expect(result.cartLevel).toEqual([])
  })

  it('3. несколько insufficient_stock с одним cartItemId накапливаются в один список (не перетирают)', () => {
    const first = insufficientStock('item-1', 3)
    const second = insufficientStock('item-1', 1)
    const result = groupCartWarnings([first, second])
    expect(result.byCartItemId.get('item-1')).toEqual([first, second])
  })

  it('4. duplicate_substance уходит в cartLevel, НЕ в byCartItemId (у DTO нет cartItemId)', () => {
    const warning = duplicateSubstance('med-a', 'med-b')
    const result = groupCartWarnings([warning])
    expect(result.cartLevel).toEqual([warning])
    expect(result.byCartItemId.size).toBe(0)
  })

  it('5. смешанный массив — оба типа корректно расходятся по своим корзинам результата', () => {
    const stock = insufficientStock('item-1', 2)
    const duplicate = duplicateSubstance('med-a', 'med-b')
    const result = groupCartWarnings([stock, duplicate])
    expect(result.byCartItemId.get('item-1')).toEqual([stock])
    expect(result.cartLevel).toEqual([duplicate])
  })
})
