/**
 * Тест `ExtendCartHoldUseCase` (EP-09, DTJ-224, «Что сделать» §5).
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AppConfigService } from '@/config/app-config.service.js'
import { InMemoryCartRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-repository.fixture.js'
import { FakeCartHoldStorePort } from '@/modules/orders/testing/fixtures/fake-cart-hold-store-port.fixture.js'
import { ExtendCartHoldUseCase } from './extend-cart-hold.use-case.js'

const TENANT_ID = randomUUID()
const OTHER_TENANT_ID = randomUUID()
const CART_HOLD_TTL_SECONDS_TEST = 900

class StubConfig {
  cartHoldTtlSeconds = CART_HOLD_TTL_SECONDS_TEST
}

function setUp() {
  const cartRepository = new InMemoryCartRepository()
  const cartId = randomUUID()
  cartRepository.seedCart({ id: cartId, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-1' })
  const itemA = { id: randomUUID(), cartId, medicineId: randomUUID(), pharmacyId: randomUUID(), quantity: 2, addedAt: new Date() }
  const itemB = { id: randomUUID(), cartId, medicineId: randomUUID(), pharmacyId: randomUUID(), quantity: 1, addedAt: new Date() }
  cartRepository.seedItem(itemA)
  cartRepository.seedItem(itemB)
  const cartHoldStore = new FakeCartHoldStorePort()
  const useCase = new ExtendCartHoldUseCase(cartRepository, cartHoldStore, new StubConfig() as unknown as AppConfigService)
  return { cartId, itemA, itemB, cartHoldStore, useCase }
}

describe('ExtendCartHoldUseCase', () => {
  it('продлевает холды ВСЕХ строк корзины на CART_HOLD_TTL_SECONDS', async () => {
    const { cartId, itemA, itemB, cartHoldStore, useCase } = setUp()

    await useCase.execute(TENANT_ID, cartId)

    expect(cartHoldStore.extendCalls).toHaveLength(2)
    expect(cartHoldStore.extendCalls).toContainEqual({
      pharmacyId: itemA.pharmacyId,
      medicineId: itemA.medicineId,
      cartItemId: itemA.id,
      ttlSeconds: CART_HOLD_TTL_SECONDS_TEST,
    })
    expect(cartHoldStore.extendCalls).toContainEqual({
      pharmacyId: itemB.pharmacyId,
      medicineId: itemB.medicineId,
      cartItemId: itemB.id,
      ttlSeconds: CART_HOLD_TTL_SECONDS_TEST,
    })
  })

  it('пустая корзина — no-op, не падает', async () => {
    const cartRepository = new InMemoryCartRepository()
    const cartId = randomUUID()
    cartRepository.seedCart({ id: cartId, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-1' })
    const cartHoldStore = new FakeCartHoldStorePort()
    const useCase = new ExtendCartHoldUseCase(cartRepository, cartHoldStore, new StubConfig() as unknown as AppConfigService)

    await expect(useCase.execute(TENANT_ID, cartId)).resolves.toBeUndefined()
    expect(cartHoldStore.extendCalls).toHaveLength(0)
  })

  it('SRS-API-046: чужой tenantId → [] от findItemsByCartId, no-op (не бросает, не продлевает чужие холды)', async () => {
    const { cartId, cartHoldStore, useCase } = setUp()

    await useCase.execute(OTHER_TENANT_ID, cartId)

    expect(cartHoldStore.extendCalls).toHaveLength(0)
  })
})
