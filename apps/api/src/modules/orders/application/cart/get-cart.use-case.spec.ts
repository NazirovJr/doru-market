/**
 * Тест `GetCartUseCase` (EP-09, DTJ-225). Каждый кейс — один критерий приёмки тикета плюс
 * конкурентное чтение (тест-план) и запрет N+1 (DoD).
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import { InMemoryCartRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-repository.fixture.js'
import { FakeCatalogFacadePort } from '@/modules/orders/testing/fixtures/fake-catalog-facade-port.fixture.js'
import type { AvailabilityCalculator } from './availability-calculator.service.js'
import { SplitCartByPharmacyUseCase } from './split-cart-by-pharmacy.use-case.js'
import { GetCartUseCase } from './get-cart.use-case.js'
import { CART_ITEM_WARNING_INSUFFICIENT_STOCK } from './dto/cart-view.dto.js'

const TENANT_ID = randomUUID()

interface AvailabilityCall {
  readonly pharmacyId: string
  readonly medicineId: string
  readonly excludeCartItemId: string | undefined
}

/** Fake `AvailabilityCalculator` (концкретный класс, не порт) — та же семантика ключа, что реальный: по `excludeCartItemId`. */
class FakeAvailabilityCalculator {
  readonly calls: AvailabilityCall[] = []
  private readonly byCartItemId = new Map<string, number>()

  setAvailableQuantity(cartItemId: string, quantity: number): void {
    this.byCartItemId.set(cartItemId, quantity)
  }

  getAvailableQuantity(pharmacyId: string, medicineId: string, excludeCartItemId?: string): Promise<number> {
    this.calls.push({ pharmacyId, medicineId, excludeCartItemId })
    return Promise.resolve(excludeCartItemId === undefined ? 0 : (this.byCartItemId.get(excludeCartItemId) ?? 0))
  }
}

/**
 * Fake `OnboardingFacadePort` — только `getPharmacyNames` нужен `GetCartUseCase` (DTJ-225,
 * доработка по замечанию CTO). `isPharmacyActive` не вызывается этим use case'ом.
 */
class FakeOnboardingFacadePort {
  callCount = 0
  private readonly names = new Map<string, string>()

  setPharmacyName(pharmacyId: string, name: string): void {
    this.names.set(pharmacyId, name)
  }

  isPharmacyActive(): Promise<boolean> {
    return Promise.resolve(true)
  }

  getPharmacyNames(pharmacyIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    this.callCount += 1
    const out = new Map<string, string>()
    for (const id of pharmacyIds) {
      const name = this.names.get(id)
      if (name !== undefined) out.set(id, name)
    }
    return Promise.resolve(out)
  }
}

function setUp() {
  const cartRepository = new InMemoryCartRepository()
  const catalogFacadePort = new FakeCatalogFacadePort()
  const onboardingFacadePort = new FakeOnboardingFacadePort()
  const availabilityCalculator = new FakeAvailabilityCalculator()
  const useCase = new GetCartUseCase(
    cartRepository,
    catalogFacadePort,
    onboardingFacadePort,
    availabilityCalculator as unknown as AvailabilityCalculator,
    new SplitCartByPharmacyUseCase(),
  )
  return { cartRepository, catalogFacadePort, onboardingFacadePort, availabilityCalculator, useCase }
}

function seedCartWithItem(
  cartRepository: InMemoryCartRepository,
  overrides: { cartId?: string; itemId?: string; medicineId?: string; pharmacyId?: string; quantity?: number } = {},
) {
  const cartId = overrides.cartId ?? randomUUID()
  const itemId = overrides.itemId ?? randomUUID()
  const medicineId = overrides.medicineId ?? randomUUID()
  const pharmacyId = overrides.pharmacyId ?? randomUUID()
  cartRepository.seedCart({ id: cartId, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-1' })
  cartRepository.seedItem({
    id: itemId,
    cartId,
    medicineId,
    pharmacyId,
    quantity: overrides.quantity ?? 1,
    addedAt: new Date(),
  })
  return { cartId, itemId, medicineId, pharmacyId }
}

describe('GetCartUseCase', () => {
  it('AC1: ответ содержит АКТУАЛЬНУЮ цену, не ту, что была на момент AddCartItemUseCase', async () => {
    const { cartRepository, catalogFacadePort, availabilityCalculator, useCase } = setUp()
    const { cartId, itemId, medicineId, pharmacyId } = seedCartWithItem(cartRepository, { quantity: 2 })
    catalogFacadePort.setSnapshot({
      medicineId,
      tradeName: 'Парацетамол 500мг',
      unitPriceDiram: 500n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })
    availabilityCalculator.setAvailableQuantity(itemId, 10)

    // Цена меняется ПОСЛЕ добавления в корзину (живой пересчёт, SRS-DOM-003 — корзина цену не хранит).
    catalogFacadePort.setSnapshot({
      medicineId,
      tradeName: 'Парацетамол 500мг',
      unitPriceDiram: 750n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })

    const view = await useCase.execute(TENANT_ID, cartId)

    expect(view.items).toHaveLength(1)
    expect(view.items[0]).toMatchObject({ id: itemId, pharmacyId, priceDiram: 750n })
    // DTJ-234 (дефект приёмки): корзина рендерила UUID вместо названия — теперь несёт имя.
    expect(view.items[0]?.medicineTradeName).toBe('Парацетамол 500мг')
    expect(view.items[0]?.medicineTradeName).not.toBe(medicineId)
    expect(view.meta.pharmacyGroups[0]?.items[0]?.medicineTradeName).toBe('Парацетамол 500мг')
  })

  it('доработка по замечанию CTO: pharmacyName резолвится через OnboardingFacadePort, когда имя известно', async () => {
    const { cartRepository, catalogFacadePort, onboardingFacadePort, availabilityCalculator, useCase } = setUp()
    const { cartId, itemId, medicineId, pharmacyId } = seedCartWithItem(cartRepository, { quantity: 1 })
    catalogFacadePort.setSnapshot({
      medicineId,
      unitPriceDiram: 100n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })
    availabilityCalculator.setAvailableQuantity(itemId, 5)
    onboardingFacadePort.setPharmacyName(pharmacyId, 'Аптека Салом')

    const view = await useCase.execute(TENANT_ID, cartId)

    expect(view.items[0]?.pharmacyName).toBe('Аптека Салом')
    expect(view.meta.pharmacyGroups[0]?.pharmacyName).toBe('Аптека Салом')
  })

  it('доработка по замечанию CTO: имя аптеки НЕИЗВЕСТНО → pharmacyName=null, НИКОГДА не pharmacyId (запрещённая подмена)', async () => {
    const { cartRepository, catalogFacadePort, availabilityCalculator, useCase } = setUp()
    const { cartId, itemId, medicineId, pharmacyId } = seedCartWithItem(cartRepository, { quantity: 1 })
    catalogFacadePort.setSnapshot({
      medicineId,
      unitPriceDiram: 100n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })
    availabilityCalculator.setAvailableQuantity(itemId, 5)
    // OnboardingFacadePort ничего не знает про эту аптеку (NullAdapter-подобное поведение).

    const view = await useCase.execute(TENANT_ID, cartId)

    expect(view.items[0]?.pharmacyName).toBeNull()
    expect(view.items[0]?.pharmacyName).not.toBe(pharmacyId)
    expect(view.meta.pharmacyGroups[0]?.pharmacyName).toBeNull()
    expect(view.meta.pharmacyGroups[0]?.pharmacyName).not.toBe(pharmacyId)
  })

  it('AC2: quantity=5, availableQuantity=3 → warnings содержит insufficient_stock, quantity В items НЕ обрезано', async () => {
    const { cartRepository, catalogFacadePort, availabilityCalculator, useCase } = setUp()
    const { cartId, itemId, medicineId } = seedCartWithItem(cartRepository, { quantity: 5 })
    catalogFacadePort.setSnapshot({
      medicineId,
      unitPriceDiram: 100n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })
    availabilityCalculator.setAvailableQuantity(itemId, 3)

    const view = await useCase.execute(TENANT_ID, cartId)

    expect(view.meta.warnings).toEqual([
      { cartItemId: itemId, type: CART_ITEM_WARNING_INSUFFICIENT_STOCK, availableQuantity: 3 },
    ])
    expect(view.items[0]?.quantity).toBe(5)
  })

  it('AC2b: quantity <= availableQuantity → БЕЗ предупреждения', async () => {
    const { cartRepository, catalogFacadePort, availabilityCalculator, useCase } = setUp()
    const { cartId, itemId, medicineId } = seedCartWithItem(cartRepository, { quantity: 3 })
    catalogFacadePort.setSnapshot({
      medicineId,
      unitPriceDiram: 100n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })
    availabilityCalculator.setAvailableQuantity(itemId, 3)

    const view = await useCase.execute(TENANT_ID, cartId)

    expect(view.meta.warnings).toEqual([])
  })

  it('AC3: корзина из 2 аптек → meta.pharmacyGroups.length === 2', async () => {
    const { cartRepository, catalogFacadePort, availabilityCalculator, useCase } = setUp()
    const cartId = randomUUID()
    cartRepository.seedCart({ id: cartId, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-1' })
    const { itemId: itemA, medicineId: medA, pharmacyId: pharmA } = seedCartWithItem(cartRepository, {
      cartId,
      quantity: 1,
    })
    const { itemId: itemB, medicineId: medB, pharmacyId: pharmB } = seedCartWithItem(cartRepository, {
      cartId,
      quantity: 1,
    })
    for (const medicineId of [medA, medB]) {
      catalogFacadePort.setSnapshot({
        medicineId,
        unitPriceDiram: 100n,
        isPrescriptionRequired: false,
        controlCategory: 'none',
      })
    }
    availabilityCalculator.setAvailableQuantity(itemA, 5)
    availabilityCalculator.setAvailableQuantity(itemB, 5)
    expect(pharmA).not.toBe(pharmB) // sanity: seedCartWithItem генерирует РАЗНЫЕ pharmacyId по умолчанию

    const view = await useCase.execute(TENANT_ID, cartId)

    expect(view.meta.pharmacyGroups).toHaveLength(2)
  })

  it('AC4: пустая корзина → items: [], meta.pharmacyGroups: [], meta.warnings: [] (не null/undefined)', async () => {
    const { cartRepository, useCase } = setUp()
    const cartId = randomUUID()
    cartRepository.seedCart({ id: cartId, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-1' })

    const view = await useCase.execute(TENANT_ID, cartId)

    expect(view).toEqual({ items: [], meta: { pharmacyGroups: [], warnings: [] } })
  })

  it('несуществующая/чужая корзина → NotFoundError (SRS-API-046)', async () => {
    const { useCase } = setUp()
    await expect(useCase.execute(TENANT_ID, randomUUID())).rejects.toBeInstanceOf(NotFoundError)
  })

  it('конкурентное чтение: два вызова подряд с изменившейся ценой между ними отражают СВОЙ момент времени', async () => {
    const { cartRepository, catalogFacadePort, availabilityCalculator, useCase } = setUp()
    const { cartId, itemId, medicineId } = seedCartWithItem(cartRepository, { quantity: 1 })
    availabilityCalculator.setAvailableQuantity(itemId, 5)
    catalogFacadePort.setSnapshot({
      medicineId,
      unitPriceDiram: 100n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })

    const first = await useCase.execute(TENANT_ID, cartId)

    catalogFacadePort.setSnapshot({
      medicineId,
      unitPriceDiram: 200n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })
    const second = await useCase.execute(TENANT_ID, cartId)

    expect(first.items[0]?.priceDiram).toBe(100n)
    expect(second.items[0]?.priceDiram).toBe(200n)
  })

  it('DoD: НЕ выполняет N+1 к CatalogFacadePort — ровно ОДИН вызов getMedicineSnapshot на несколько позиций', async () => {
    const { cartRepository, catalogFacadePort, onboardingFacadePort, availabilityCalculator, useCase } = setUp()
    const cartId = randomUUID()
    cartRepository.seedCart({ id: cartId, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-1' })
    const seededA = seedCartWithItem(cartRepository, { cartId })
    const seededB = seedCartWithItem(cartRepository, { cartId })
    const seededC = seedCartWithItem(cartRepository, { cartId })
    for (const seeded of [seededA, seededB, seededC]) {
      catalogFacadePort.setSnapshot({
        medicineId: seeded.medicineId,
        unitPriceDiram: 100n,
        isPrescriptionRequired: false,
        controlCategory: 'none',
      })
      availabilityCalculator.setAvailableQuantity(seeded.itemId, 5)
    }
    let snapshotCalls = 0
    const originalGetSnapshot = catalogFacadePort.getMedicineSnapshot.bind(catalogFacadePort)
    catalogFacadePort.getMedicineSnapshot = (ids: readonly string[]) => {
      snapshotCalls += 1
      return originalGetSnapshot(ids)
    }

    await useCase.execute(TENANT_ID, cartId)

    expect(snapshotCalls).toBe(1)
    expect(onboardingFacadePort.callCount).toBe(1)
    expect(availabilityCalculator.calls).toHaveLength(3)
  })

  it('медикамент без снапшота (снят с публикации после добавления) — исключается из items, не роняет весь просмотр', async () => {
    const { cartRepository, catalogFacadePort, availabilityCalculator, useCase } = setUp()
    const cartId = randomUUID()
    cartRepository.seedCart({ id: cartId, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-1' })
    const gone = seedCartWithItem(cartRepository, { cartId })
    const present = seedCartWithItem(cartRepository, { cartId })
    catalogFacadePort.setSnapshot({
      medicineId: present.medicineId,
      unitPriceDiram: 100n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })
    availabilityCalculator.setAvailableQuantity(present.itemId, 5)
    availabilityCalculator.setAvailableQuantity(gone.itemId, 5)

    const view = await useCase.execute(TENANT_ID, cartId)

    expect(view.items).toHaveLength(1)
    expect(view.items[0]?.id).toBe(present.itemId)
  })
})
