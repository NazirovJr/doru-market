/**
 * Unit-тесты `ReturnsPolicy` (EP-11, DTJ-273/275) — точная проверка владения, независимо от
 * use case/HTTP-слоя (тест-план DTJ-273 п. «AdminOverrideReturnUseCase без роли... — доступ
 * запрещён на уровне ReturnsPolicy (unit-тест политики отдельно от use case)», DoD DTJ-275
 * «RBAC-проверки покрыты минимум одним негативным тестом на каждый эндпоинт»).
 */
import { describe, expect, it } from 'vitest'
import type { OrderReturnContext } from './application/ports/orders-facade.port.js'
import { ReturnsPolicy, type ReturnsPolicyActor } from './returns-policy.guard.js'

function makeOrder(overrides: Partial<OrderReturnContext> = {}): OrderReturnContext {
  return {
    orderId: 'order-1',
    status: 'delivered',
    pharmacyId: 'pharmacy-1',
    chainId: 'chain-1',
    customerId: 'customer-1',
    paymentMethod: 'alif_mobi',
    billingStrategy: 'single_invoice',
    deliveredAt: new Date('2026-09-01T00:00:00.000Z'),
    courierId: 'courier-1',
    items: [],
    itemsTotalDiram: 5_000n,
    deliveryFeeDiram: 1_000n,
    totalAmountDiram: 6_000n,
    ...overrides,
  }
}

const policy = new ReturnsPolicy()

describe('ReturnsPolicy.canOverride/canDispatch (DTJ-273/275) — pharmacy_admin своей сети/super_admin', () => {
  it('super_admin — разрешено независимо от сети', () => {
    const actor: ReturnsPolicyActor = { role: 'super_admin', pharmacyId: null, chainId: null }
    expect(policy.canOverride(actor, makeOrder())).toBe(true)
    expect(policy.canDispatch(actor, makeOrder())).toBe(true)
  })

  it('pharmacy_admin СВОЕЙ сети — разрешено', () => {
    const actor: ReturnsPolicyActor = { role: 'pharmacy_admin', pharmacyId: 'pharmacy-1', chainId: 'chain-1' }
    expect(policy.canOverride(actor, makeOrder({ chainId: 'chain-1' }))).toBe(true)
  })

  it('pharmacy_admin ЧУЖОЙ сети — 403 (негативный сценарий)', () => {
    const actor: ReturnsPolicyActor = { role: 'pharmacy_admin', pharmacyId: null, chainId: 'chain-2' }
    expect(policy.canOverride(actor, makeOrder({ chainId: 'chain-1' }))).toBe(false)
  })

  it('pharmacy_admin БЕЗ сети (chainId=null) — 403, даже если у заказа тоже нет сети (null не совпадает с null)', () => {
    const actor: ReturnsPolicyActor = { role: 'pharmacy_admin', pharmacyId: null, chainId: null }
    expect(policy.canOverride(actor, makeOrder({ chainId: null }))).toBe(false)
  })

  it('customer/courier — 403 (роль не диспетчерская)', () => {
    expect(policy.canDispatch({ role: 'customer', pharmacyId: null, chainId: null, userId: 'customer-1' }, makeOrder())).toBe(false)
    expect(policy.canDispatch({ role: 'courier', pharmacyId: null, chainId: null, courierId: 'courier-1' }, makeOrder())).toBe(false)
  })
})

describe('ReturnsPolicy.canConfirmOrReject (DTJ-275) — pharmacist своей аптеки/super_admin', () => {
  it('pharmacist СВОЕЙ аптеки — разрешено', () => {
    const actor: ReturnsPolicyActor = { role: 'pharmacist', pharmacyId: 'pharmacy-1', chainId: null }
    expect(policy.canConfirmOrReject(actor, makeOrder({ pharmacyId: 'pharmacy-1' }))).toBe(true)
  })

  it('AC4 — pharmacist ЧУЖОЙ аптеки → 403 (негативный сценарий)', () => {
    const actor: ReturnsPolicyActor = { role: 'pharmacist', pharmacyId: 'pharmacy-2', chainId: null }
    expect(policy.canConfirmOrReject(actor, makeOrder({ pharmacyId: 'pharmacy-1' }))).toBe(false)
  })

  it('super_admin — разрешено независимо от аптеки', () => {
    const actor: ReturnsPolicyActor = { role: 'super_admin', pharmacyId: null, chainId: null }
    expect(policy.canConfirmOrReject(actor, makeOrder())).toBe(true)
  })

  it('customer/pharmacy_admin — 403 (роль не годится для confirm/reject)', () => {
    expect(policy.canConfirmOrReject({ role: 'customer', pharmacyId: null, chainId: null, userId: 'customer-1' }, makeOrder())).toBe(false)
    expect(policy.canConfirmOrReject({ role: 'pharmacy_admin', pharmacyId: 'pharmacy-1', chainId: 'chain-1' }, makeOrder({ chainId: 'chain-1' }))).toBe(
      false,
    )
  })
})

describe('ReturnsPolicy.canRequest (DTJ-275) — customer свой заказ/courier назначен/super_admin', () => {
  it('customer СВОЙ заказ — разрешено', () => {
    const actor: ReturnsPolicyActor = { role: 'customer', pharmacyId: null, chainId: null, userId: 'customer-1' }
    expect(policy.canRequest(actor, makeOrder({ customerId: 'customer-1' }))).toBe(true)
  })

  it('customer ЧУЖОЙ заказ — 403 (негативный сценарий)', () => {
    const actor: ReturnsPolicyActor = { role: 'customer', pharmacyId: null, chainId: null, userId: 'customer-2' }
    expect(policy.canRequest(actor, makeOrder({ customerId: 'customer-1' }))).toBe(false)
  })

  it('AC2 — courier, НЕ назначенный на доставку этого заказа — 403 (негативный сценарий)', () => {
    const actor: ReturnsPolicyActor = { role: 'courier', pharmacyId: null, chainId: null, courierId: 'courier-2' }
    expect(policy.canRequest(actor, makeOrder({ courierId: 'courier-1' }))).toBe(false)
  })

  it('courier НАЗНАЧЕННЫЙ на доставку этого заказа — разрешено', () => {
    const actor: ReturnsPolicyActor = { role: 'courier', pharmacyId: null, chainId: null, courierId: 'courier-1' }
    expect(policy.canRequest(actor, makeOrder({ courierId: 'courier-1' }))).toBe(true)
  })

  it('courier без резолвленного профиля (courierId=null) — 403, даже если у заказа тоже нет курьера', () => {
    const actor: ReturnsPolicyActor = { role: 'courier', pharmacyId: null, chainId: null, courierId: null }
    expect(policy.canRequest(actor, makeOrder({ courierId: null }))).toBe(false)
  })

  it('super_admin — разрешено', () => {
    expect(policy.canRequest({ role: 'super_admin', pharmacyId: null, chainId: null }, makeOrder())).toBe(true)
  })

  it('pharmacist/pharmacy_admin — 403 (роль не годится для request)', () => {
    expect(policy.canRequest({ role: 'pharmacist', pharmacyId: 'pharmacy-1', chainId: null }, makeOrder())).toBe(false)
  })
})

describe('ReturnsPolicy.canRead (DTJ-275) — владелец заказа/pharmacist своей аптеки/super_admin', () => {
  it('владелец заказа (customer) — разрешено', () => {
    const actor: ReturnsPolicyActor = { role: 'customer', pharmacyId: null, chainId: null, userId: 'customer-1' }
    expect(policy.canRead(actor, makeOrder({ customerId: 'customer-1' }))).toBe(true)
  })

  it('чужой customer — 403 (негативный сценарий)', () => {
    const actor: ReturnsPolicyActor = { role: 'customer', pharmacyId: null, chainId: null, userId: 'customer-2' }
    expect(policy.canRead(actor, makeOrder({ customerId: 'customer-1' }))).toBe(false)
  })

  it('pharmacist СВОЕЙ аптеки — разрешено, ЧУЖОЙ — 403', () => {
    expect(policy.canRead({ role: 'pharmacist', pharmacyId: 'pharmacy-1', chainId: null }, makeOrder({ pharmacyId: 'pharmacy-1' }))).toBe(true)
    expect(policy.canRead({ role: 'pharmacist', pharmacyId: 'pharmacy-2', chainId: null }, makeOrder({ pharmacyId: 'pharmacy-1' }))).toBe(false)
  })

  it('super_admin — разрешено', () => {
    expect(policy.canRead({ role: 'super_admin', pharmacyId: null, chainId: null }, makeOrder())).toBe(true)
  })

  it('courier/pharmacy_admin — 403 (роль не входит в список читателей GET /:id)', () => {
    expect(policy.canRead({ role: 'courier', pharmacyId: null, chainId: null, courierId: 'courier-1' }, makeOrder({ courierId: 'courier-1' }))).toBe(
      false,
    )
  })
})
