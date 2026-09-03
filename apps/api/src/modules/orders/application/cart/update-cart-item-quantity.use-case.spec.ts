import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import type { AppConfigService } from '@/config/app-config.service.js'
import { InMemoryCartRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-repository.fixture.js'
import { FakeCartHoldStorePort } from '@/modules/orders/testing/fixtures/fake-cart-hold-store-port.fixture.js'
import { RemoveCartItemUseCase } from './remove-cart-item.use-case.js'
import { UpdateCartItemQuantityUseCase } from './update-cart-item-quantity.use-case.js'

const TENANT_ID = randomUUID()
const OTHER_TENANT_ID = randomUUID()
const CART_HOLD_TTL_SECONDS_TEST = 900

/** Узкий стаб `AppConfigService` (тот же приём, что `request-otp.use-case.spec.ts`). */
class StubConfig {
  cartHoldTtlSeconds = CART_HOLD_TTL_SECONDS_TEST
}

function setUp() {
  const cartRepository = new InMemoryCartRepository()
  const cartId = randomUUID()
  const itemId = randomUUID()
  const pharmacyId = randomUUID()
  const medicineId = randomUUID()
  cartRepository.seedCart({ id: cartId, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-1' })
  cartRepository.seedItem({
    id: itemId,
    cartId,
    medicineId,
    pharmacyId,
    quantity: 5,
    addedAt: new Date(),
  })
  const removeCartItemUseCase = new RemoveCartItemUseCase(cartRepository)
  const cartHoldStore = new FakeCartHoldStorePort()
  const useCase = new UpdateCartItemQuantityUseCase(
    cartRepository,
    removeCartItemUseCase,
    cartHoldStore,
    new StubConfig() as unknown as AppConfigService,
  )
  return { cartRepository, cartId, itemId, pharmacyId, medicineId, cartHoldStore, useCase }
}

describe('UpdateCartItemQuantityUseCase', () => {
  it('AC5: quantity=0 → строка удалена, не записана с quantity=0', async () => {
    const { cartRepository, cartId, itemId, useCase } = setUp()

    const result = await useCase.execute({ tenantId: TENANT_ID, cartId, cartItemId: itemId, quantity: 0 })

    expect(result).toEqual({ kind: 'removed' })
    expect(await cartRepository.findItemsByCartId(TENANT_ID, cartId)).toHaveLength(0)
  })

  it('quantity отрицательный → тоже эквивалентно удалению', async () => {
    const { cartId, itemId, useCase } = setUp()

    const result = await useCase.execute({ tenantId: TENANT_ID, cartId, cartItemId: itemId, quantity: -1 })

    expect(result).toEqual({ kind: 'removed' })
  })

  it('quantity положительный → UPDATE, возвращает обновлённую строку', async () => {
    const { cartRepository, cartId, itemId, useCase } = setUp()

    const result = await useCase.execute({ tenantId: TENANT_ID, cartId, cartItemId: itemId, quantity: 9 })

    expect(result.kind).toBe('updated')
    if (result.kind === 'updated') {
      expect(result.item.quantity).toBe(9)
    }
    const items = await cartRepository.findItemsByCartId(TENANT_ID, cartId)
    expect(items[0]?.quantity).toBe(9)
  })

  it('DTJ-224: quantity положительный → ставит мягкий Redis-холд НОВЫМ количеством', async () => {
    const { cartId, itemId, pharmacyId, medicineId, cartHoldStore, useCase } = setUp()

    await useCase.execute({ tenantId: TENANT_ID, cartId, cartItemId: itemId, quantity: 9 })

    expect(cartHoldStore.holdCalls).toEqual([
      { pharmacyId, medicineId, cartItemId: itemId, quantity: 9, ttlSeconds: CART_HOLD_TTL_SECONDS_TEST },
    ])
  })

  it('DTJ-224: quantity=0 (удаление) НЕ ставит холд — порт не умеет снимать резерв', async () => {
    const { cartId, itemId, cartHoldStore, useCase } = setUp()

    await useCase.execute({ tenantId: TENANT_ID, cartId, cartItemId: itemId, quantity: 0 })

    expect(cartHoldStore.holdCalls).toHaveLength(0)
  })

  it('несуществующая строка → not_found', async () => {
    const { cartId, useCase } = setUp()

    const result = await useCase.execute({ tenantId: TENANT_ID, cartId, cartItemId: randomUUID(), quantity: 3 })

    expect(result).toEqual({ kind: 'not_found' })
  })

  it('нецелое quantity → ValidationError', async () => {
    const { cartId, itemId, useCase } = setUp()

    await expect(
      useCase.execute({ tenantId: TENANT_ID, cartId, cartItemId: itemId, quantity: 1.5 }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('SRS-API-046: ЧУЖОЙ tenantId → not_found, quantity не изменена (тенант-изоляция)', async () => {
    const { cartRepository, cartId, itemId, useCase } = setUp()

    const result = await useCase.execute({ tenantId: OTHER_TENANT_ID, cartId, cartItemId: itemId, quantity: 42 })

    expect(result).toEqual({ kind: 'not_found' })
    const items = await cartRepository.findItemsByCartId(TENANT_ID, cartId)
    expect(items[0]?.quantity).toBe(5)
  })

  it('SRS-API-046: ЧУЖОЙ tenantId с quantity<=0 → not_found (не removed), строка не удалена', async () => {
    const { cartRepository, cartId, itemId, useCase } = setUp()

    const result = await useCase.execute({ tenantId: OTHER_TENANT_ID, cartId, cartItemId: itemId, quantity: 0 })

    expect(result).toEqual({ kind: 'not_found' })
    expect(await cartRepository.findItemsByCartId(TENANT_ID, cartId)).toHaveLength(1)
  })
})
