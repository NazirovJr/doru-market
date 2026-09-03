import { describe, expect, it } from 'vitest'
import { InMemoryCartRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-repository.fixture.js'
import { InMemoryCartIdentityRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-identity-repository.fixture.js'
import { MergeGuestCartUseCase } from './merge-guest-cart.use-case.js'

const TENANT_ID = 'tenant-1'
const TENANT_ID_B = 'tenant-2'

describe('MergeGuestCartUseCase (DTJ-226, SRS-ORD-020, критерии приёмки №1/№2)', () => {
  it('гостевой корзины с этим sessionToken нет — no-op, {merged: false}, не бросает', async () => {
    const useCase = new MergeGuestCartUseCase(new InMemoryCartRepository(), new InMemoryCartIdentityRepository())

    const result = await useCase.execute(TENANT_ID, 'no-such-token', 'customer-1')

    expect(result).toEqual({ merged: false, cartId: null })
  })

  it('критерий №1: у клиента ещё нет своей корзины — гостевая ПЕРЕПРИВЯЗЫВАЕТСЯ (не построчный перенос)', async () => {
    const cartRepo = new InMemoryCartRepository()
    const identityRepo = new InMemoryCartIdentityRepository()
    identityRepo.seedCart({ id: 'guest-cart', tenantId: TENANT_ID, customerId: null, sessionToken: 'tok' })
    cartRepo.seedCart({ id: 'guest-cart', tenantId: TENANT_ID, customerId: null, sessionToken: 'tok' })
    cartRepo.seedItem({
      id: 'item-1',
      cartId: 'guest-cart',
      medicineId: 'med-1',
      pharmacyId: 'pharm-1',
      quantity: 2,
      addedAt: new Date(),
    })
    const useCase = new MergeGuestCartUseCase(cartRepo, identityRepo)

    const result = await useCase.execute(TENANT_ID, 'tok', 'customer-1')

    expect(result).toEqual({ merged: true, cartId: 'guest-cart' })
    // Позиции остались под ТЕМ ЖЕ cart.id — они не переносились построчно.
    const items = await cartRepo.findItemsByCartId(TENANT_ID, 'guest-cart')
    expect(items).toHaveLength(1)
    expect(items[0]?.quantity).toBe(2)
    const rebound = await identityRepo.findByCustomerId(TENANT_ID, 'customer-1')
    expect(rebound?.id).toBe('guest-cart')
    expect(rebound?.sessionToken).toBeNull()
  })

  it('критерий №2: у клиента УЖЕ есть корзина с ТЕМ ЖЕ товаром — количества СУММИРУЮТСЯ, не дублируется строка, гостевая cart удаляется', async () => {
    const cartRepo = new InMemoryCartRepository()
    const identityRepo = new InMemoryCartIdentityRepository()
    identityRepo.seedCart({ id: 'guest-cart', tenantId: TENANT_ID, customerId: null, sessionToken: 'tok' })
    identityRepo.seedCart({ id: 'customer-cart', tenantId: TENANT_ID, customerId: 'customer-1', sessionToken: null })
    cartRepo.seedCart({ id: 'guest-cart', tenantId: TENANT_ID, customerId: null, sessionToken: 'tok' })
    cartRepo.seedCart({ id: 'customer-cart', tenantId: TENANT_ID, customerId: 'customer-1', sessionToken: null })
    cartRepo.seedItem({
      id: 'guest-item',
      cartId: 'guest-cart',
      medicineId: 'med-1',
      pharmacyId: 'pharm-1',
      quantity: 3,
      addedAt: new Date(),
    })
    cartRepo.seedItem({
      id: 'customer-item',
      cartId: 'customer-cart',
      medicineId: 'med-1',
      pharmacyId: 'pharm-1',
      quantity: 5,
      addedAt: new Date(),
    })
    const useCase = new MergeGuestCartUseCase(cartRepo, identityRepo)

    const result = await useCase.execute(TENANT_ID, 'tok', 'customer-1')

    expect(result).toEqual({ merged: true, cartId: 'customer-cart' })
    const items = await cartRepo.findItemsByCartId(TENANT_ID, 'customer-cart')
    expect(items).toHaveLength(1)
    expect(items[0]?.quantity).toBe(8) // 5 + 3, СУММА, не перезапись
    // Гостевая cart удалена — не сирота.
    expect(await identityRepo.findBySessionToken(TENANT_ID, 'tok')).toBeNull()
  })

  it('критерий №2 (разные товары): позиция без пересечения переносится отдельной строкой, обе видны в целевой корзине', async () => {
    const cartRepo = new InMemoryCartRepository()
    const identityRepo = new InMemoryCartIdentityRepository()
    identityRepo.seedCart({ id: 'guest-cart', tenantId: TENANT_ID, customerId: null, sessionToken: 'tok' })
    identityRepo.seedCart({ id: 'customer-cart', tenantId: TENANT_ID, customerId: 'customer-1', sessionToken: null })
    cartRepo.seedCart({ id: 'guest-cart', tenantId: TENANT_ID, customerId: null, sessionToken: 'tok' })
    cartRepo.seedCart({ id: 'customer-cart', tenantId: TENANT_ID, customerId: 'customer-1', sessionToken: null })
    cartRepo.seedItem({
      id: 'guest-item',
      cartId: 'guest-cart',
      medicineId: 'med-2',
      pharmacyId: 'pharm-1',
      quantity: 1,
      addedAt: new Date(),
    })
    cartRepo.seedItem({
      id: 'customer-item',
      cartId: 'customer-cart',
      medicineId: 'med-1',
      pharmacyId: 'pharm-1',
      quantity: 5,
      addedAt: new Date(),
    })
    const useCase = new MergeGuestCartUseCase(cartRepo, identityRepo)

    await useCase.execute(TENANT_ID, 'tok', 'customer-1')

    const items = await cartRepo.findItemsByCartId(TENANT_ID, 'customer-cart')
    expect(items).toHaveLength(2)
  })

  it('D-EP09-24: гостевая корзина ЧУЖОГО тенанта не резолвится и не переносится', async () => {
    const cartRepo = new InMemoryCartRepository()
    const identityRepo = new InMemoryCartIdentityRepository()
    identityRepo.seedCart({ id: 'guest-cart', tenantId: TENANT_ID_B, customerId: null, sessionToken: 'tok' })
    const useCase = new MergeGuestCartUseCase(cartRepo, identityRepo)

    const result = await useCase.execute(TENANT_ID, 'tok', 'customer-1')

    expect(result).toEqual({ merged: false, cartId: null })
  })
})
