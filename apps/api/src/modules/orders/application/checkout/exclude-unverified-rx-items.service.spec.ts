/**
 * `ExcludeUnverifiedRxItemsService` (EP-09, DTJ-230) — unit-набор: покрытая Rx / непокрытая
 * Rx / смешанная группа / группа целиком из непокрытых Rx (тест-план тикета, AC1/AC2).
 */
import { describe, expect, it, vi } from 'vitest'
import type { PrescriptionsFacadePort } from '@/modules/orders/application/ports/prescriptions-facade.port.js'
import {
  ExcludeUnverifiedRxItemsService,
  PRESCRIPTION_NOT_VERIFIED_REASON,
  type RxCheckItem,
} from './exclude-unverified-rx-items.service.js'

const CUSTOMER_ID = 'customer-1'

function makeService(verifiedMedicineIds: readonly string[]): { service: ExcludeUnverifiedRxItemsService; isVerifiedFor: ReturnType<typeof vi.fn> } {
  const verifiedSet = new Set(verifiedMedicineIds)
  const isVerifiedFor = vi
    .fn<PrescriptionsFacadePort['isVerifiedFor']>()
    .mockImplementation((_customerId, medicineIds) => Promise.resolve(medicineIds.every((id) => verifiedSet.has(id))))
  const port: PrescriptionsFacadePort = { isVerifiedFor }
  return { service: new ExcludeUnverifiedRxItemsService(port), isVerifiedFor }
}

function item(overrides: Partial<RxCheckItem>): RxCheckItem {
  return { cartItemId: 'cart-item-1', medicineId: 'med-1', isPrescriptionRequired: false, ...overrides }
}

describe('ExcludeUnverifiedRxItemsService (DTJ-230)', () => {
  it('не-Rx позиция → всегда orderable, порт не вызывается для неё', async () => {
    const { service, isVerifiedFor } = makeService([])
    const result = await service.exclude([item({ isPrescriptionRequired: false })], [], CUSTOMER_ID)
    expect(result.orderable).toHaveLength(1)
    expect(result.excluded).toHaveLength(0)
    expect(isVerifiedFor).not.toHaveBeenCalled()
  })

  it('Rx-позиция, верифицированный рецепт → orderable', async () => {
    const { service } = makeService(['med-rx'])
    const result = await service.exclude([item({ cartItemId: 'ci-1', medicineId: 'med-rx', isPrescriptionRequired: true })], [], CUSTOMER_ID)
    expect(result.orderable).toEqual([{ cartItemId: 'ci-1', medicineId: 'med-rx', isPrescriptionRequired: true }])
    expect(result.excluded).toHaveLength(0)
  })

  it('AC1 — Rx-позиция без верификации + обычный товар той же группы → Rx исключена с PRESCRIPTION_NOT_VERIFIED, обычный товар orderable', async () => {
    const { service } = makeService([]) // ничего не верифицировано
    const rxItem = item({ cartItemId: 'ci-rx', medicineId: 'med-rx', isPrescriptionRequired: true })
    const plainItem = item({ cartItemId: 'ci-plain', medicineId: 'med-plain', isPrescriptionRequired: false })

    const result = await service.exclude([rxItem, plainItem], [], CUSTOMER_ID)

    expect(result.orderable).toEqual([plainItem])
    expect(result.excluded).toEqual([{ cartItemId: 'ci-rx', reason: PRESCRIPTION_NOT_VERIFIED_REASON }])
  })

  it('AC2 — корзина целиком из непокрытых Rx → orderable пуст, все excluded', async () => {
    const { service } = makeService([])
    const items = [
      item({ cartItemId: 'ci-1', medicineId: 'med-a', isPrescriptionRequired: true }),
      item({ cartItemId: 'ci-2', medicineId: 'med-b', isPrescriptionRequired: true }),
    ]
    const result = await service.exclude(items, [], CUSTOMER_ID)
    expect(result.orderable).toHaveLength(0)
    expect(result.excluded.map((e) => e.reason)).toEqual([PRESCRIPTION_NOT_VERIFIED_REASON, PRESCRIPTION_NOT_VERIFIED_REASON])
  })

  it('несколько позиций одного Rx-medicineId → isVerifiedFor вызывается ОДИН раз на medicineId (не N+1)', async () => {
    const { service, isVerifiedFor } = makeService(['med-rx'])
    const items = [
      item({ cartItemId: 'ci-1', medicineId: 'med-rx', isPrescriptionRequired: true }),
      item({ cartItemId: 'ci-2', medicineId: 'med-rx', isPrescriptionRequired: true }),
    ]
    const result = await service.exclude(items, [], CUSTOMER_ID)
    expect(result.orderable).toHaveLength(2)
    expect(isVerifiedFor).toHaveBeenCalledTimes(1)
  })
})
