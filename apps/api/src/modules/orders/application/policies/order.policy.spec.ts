import { describe, expect, it } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import type { OrderStatus } from '@dorutj/contracts'
import { Order } from '@/modules/orders/domain/order.entity.js'
import { validOrderCreateCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { OrderPolicy, type OrderPolicyActor } from './order.policy.js'

/** `paymentMethod` выбран по `status` — `restore()` отказывает `confirmed` для non-cash и
 * `pending_payment`/`paid_escrow` для `cash_courier` (D-25, доработка после ревью CTO). */
function orderAtStatus(status: OrderStatus): Order {
  const paymentMethod = status === 'confirmed' ? 'cash_courier' : 'alif_mobi'
  const created = Order.create(
    validOrderCreateCommand({ customerId: 'customer-1', pharmacyId: 'pharmacy-1', paymentMethod }),
  )
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({ ...created.value.toSnapshot(), status })
}

describe('OrderPolicy.canCancel (DTJ-222, SRS-DOM-154, SRS-ORD-029/031)', () => {
  const owner: OrderPolicyActor = { role: 'customer', userId: 'customer-1', pharmacyId: null }
  const stranger: OrderPolicyActor = { role: 'customer', userId: 'customer-2', pharmacyId: null }
  const ownPharmacist: OrderPolicyActor = { role: 'pharmacist', userId: 'staff-1', pharmacyId: 'pharmacy-1' }
  const otherPharmacist: OrderPolicyActor = { role: 'pharmacist', userId: 'staff-2', pharmacyId: 'pharmacy-2' }
  const ownPharmacyAdmin: OrderPolicyActor = { role: 'pharmacy_admin', userId: 'admin-1', pharmacyId: 'pharmacy-1' }
  const courier: OrderPolicyActor = { role: 'courier', userId: 'courier-1', pharmacyId: null }

  it.each<[OrderStatus, boolean]>([
    ['pending_payment', true],
    ['confirmed', true],
    ['paid_escrow', true],
    ['processing', true],
    ['picked_up', false],
    ['delivered', false],
    ['cancelled', false],
    ['refunded', false],
    ['return_in_progress', false],
  ])('AC4: статус %s → canCancel(owner) = %s (SRS-DOM-154)', (status, expected) => {
    expect(OrderPolicy.canCancel(orderAtStatus(status), owner)).toBe(expected)
  })

  it('customer — свой заказ → true', () => {
    expect(OrderPolicy.canCancel(orderAtStatus('paid_escrow'), owner)).toBe(true)
  })

  it('customer — чужой заказ → false', () => {
    expect(OrderPolicy.canCancel(orderAtStatus('paid_escrow'), stranger)).toBe(false)
  })

  it('pharmacist — своя аптека → true', () => {
    expect(OrderPolicy.canCancel(orderAtStatus('paid_escrow'), ownPharmacist)).toBe(true)
  })

  it('pharmacist — чужая аптека → false', () => {
    expect(OrderPolicy.canCancel(orderAtStatus('paid_escrow'), otherPharmacist)).toBe(false)
  })

  it('pharmacy_admin — своя аптека → true', () => {
    expect(OrderPolicy.canCancel(orderAtStatus('confirmed'), ownPharmacyAdmin)).toBe(true)
  })

  it('courier — не входит в допустимые роли → false', () => {
    expect(OrderPolicy.canCancel(orderAtStatus('paid_escrow'), courier)).toBe(false)
  })
})

describe('OrderPolicy.canManagePicking (DTJ-302/303, EP-12 §A.3/A.4)', () => {
  const ownPharmacist: OrderPolicyActor = { role: 'pharmacist', userId: 'staff-1', pharmacyId: 'pharmacy-1' }
  const otherPharmacist: OrderPolicyActor = { role: 'pharmacist', userId: 'staff-2', pharmacyId: 'pharmacy-2' }
  const ownPharmacyAdmin: OrderPolicyActor = { role: 'pharmacy_admin', userId: 'admin-1', pharmacyId: 'pharmacy-1' }
  const owner: OrderPolicyActor = { role: 'customer', userId: 'customer-1', pharmacyId: null }

  it('pharmacist — своя аптека → true', () => {
    expect(OrderPolicy.canManagePicking(orderAtStatus('processing'), ownPharmacist)).toBe(true)
  })

  it('pharmacist — чужая аптека → false', () => {
    expect(OrderPolicy.canManagePicking(orderAtStatus('processing'), otherPharmacist)).toBe(false)
  })

  it('pharmacy_admin — своя аптека → false (DTJ-302: РОВНО pharmacist, в отличие от canCancel)', () => {
    expect(OrderPolicy.canManagePicking(orderAtStatus('processing'), ownPharmacyAdmin)).toBe(false)
  })

  it('customer — не входит в допустимые роли → false', () => {
    expect(OrderPolicy.canManagePicking(orderAtStatus('processing'), owner)).toBe(false)
  })
})
