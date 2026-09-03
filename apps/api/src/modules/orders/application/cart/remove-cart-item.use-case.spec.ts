import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { InMemoryCartRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-repository.fixture.js'
import { RemoveCartItemUseCase } from './remove-cart-item.use-case.js'

const TENANT_ID = randomUUID()
const OTHER_TENANT_ID = randomUUID()

function setUp() {
  const cartRepository = new InMemoryCartRepository()
  const cartId = randomUUID()
  const itemId = randomUUID()
  cartRepository.seedCart({ id: cartId, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-1' })
  cartRepository.seedItem({
    id: itemId,
    cartId,
    medicineId: randomUUID(),
    pharmacyId: randomUUID(),
    quantity: 3,
    addedAt: new Date(),
  })
  const useCase = new RemoveCartItemUseCase(cartRepository)
  return { cartRepository, cartId, itemId, useCase }
}

describe('RemoveCartItemUseCase', () => {
  it('удаляет строку, принадлежащую cartId своего тенанта', async () => {
    const { cartRepository, cartId, itemId, useCase } = setUp()

    const result = await useCase.execute(TENANT_ID, cartId, itemId)

    expect(result.removed).toBe(true)
    expect(await cartRepository.findItemsByCartId(TENANT_ID, cartId)).toHaveLength(0)
  })

  it('строка из ЧУЖОЙ корзины (другой cartId) не удаляется — removed: false (проверка владения)', async () => {
    const { cartRepository, cartId, itemId, useCase } = setUp()
    const attackerCartId = randomUUID()
    cartRepository.seedCart({ id: attackerCartId, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-2' })

    const result = await useCase.execute(TENANT_ID, attackerCartId, itemId)

    expect(result.removed).toBe(false)
    expect(await cartRepository.findItemsByCartId(TENANT_ID, cartId)).toHaveLength(1)
  })

  it('SRS-API-046: тот же cartId/itemId, но ЧУЖОЙ tenantId → removed: false, строка не тронута (тенант-изоляция)', async () => {
    const { cartRepository, cartId, itemId, useCase } = setUp()

    const result = await useCase.execute(OTHER_TENANT_ID, cartId, itemId)

    expect(result.removed).toBe(false)
    expect(await cartRepository.findItemsByCartId(TENANT_ID, cartId)).toHaveLength(1)
  })

  it('несуществующая строка — removed: false, не бросает', async () => {
    const { cartId, useCase } = setUp()

    const result = await useCase.execute(TENANT_ID, cartId, randomUUID())

    expect(result.removed).toBe(false)
  })
})
