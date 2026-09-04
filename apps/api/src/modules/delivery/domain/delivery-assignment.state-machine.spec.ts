import { describe, expect, it } from 'vitest'
import type { DeliveryAssignmentStatus } from '@dorutj/contracts'
import {
  DELIVERY_ASSIGNMENT_ALLOWED_TRANSITIONS,
  isDeliveryAssignmentTransitionAllowed,
  isReassignableStatus,
} from './delivery-assignment.state-machine.js'

const ALL_STATUSES: readonly DeliveryAssignmentStatus[] = [
  'unassigned',
  'assigned',
  'en_route_to_pharmacy',
  'picked_up_from_pharmacy',
  'en_route_to_customer',
  'delivered',
  'delivery_failed',
]

describe('DELIVERY_ASSIGNMENT_ALLOWED_TRANSITIONS — исчерпывающая матрица (DoD: позитивные И недопустимые)', () => {
  const cases = ALL_STATUSES.flatMap((from) => ALL_STATUSES.map((to) => [from, to] as const))

  it.each(cases)('%s → %s: соответствует таблице', (from, to) => {
    const expected = DELIVERY_ASSIGNMENT_ALLOWED_TRANSITIONS[from].includes(to)
    expect(isDeliveryAssignmentTransitionAllowed(from, to)).toBe(expected)
  })

  it('happy path: unassigned→assigned→en_route_to_pharmacy→picked_up_from_pharmacy→en_route_to_customer→delivered', () => {
    expect(isDeliveryAssignmentTransitionAllowed('unassigned', 'assigned')).toBe(true)
    expect(isDeliveryAssignmentTransitionAllowed('assigned', 'en_route_to_pharmacy')).toBe(true)
    expect(isDeliveryAssignmentTransitionAllowed('en_route_to_pharmacy', 'picked_up_from_pharmacy')).toBe(true)
    expect(isDeliveryAssignmentTransitionAllowed('picked_up_from_pharmacy', 'en_route_to_customer')).toBe(true)
    expect(isDeliveryAssignmentTransitionAllowed('en_route_to_customer', 'delivered')).toBe(true)
  })

  it('en_route_to_customer → delivery_failed допустим (SRS-DOM-143)', () => {
    expect(isDeliveryAssignmentTransitionAllowed('en_route_to_customer', 'delivery_failed')).toBe(true)
  })

  it('запрещено: unassigned → en_route_to_pharmacy напрямую, минуя assigned (тикет DTJ-313 явно требует)', () => {
    expect(isDeliveryAssignmentTransitionAllowed('unassigned', 'en_route_to_pharmacy')).toBe(false)
  })

  it('запрещено: assigned → delivered напрямую (обязателен полный маршрут)', () => {
    expect(isDeliveryAssignmentTransitionAllowed('assigned', 'delivered')).toBe(false)
  })

  it('терминальные состояния не имеют исходящих рёбер', () => {
    expect(DELIVERY_ASSIGNMENT_ALLOWED_TRANSITIONS.delivered).toEqual([])
    expect(DELIVERY_ASSIGNMENT_ALLOWED_TRANSITIONS.delivery_failed).toEqual([])
  })
})

describe('isReassignableStatus — SRS-DOM-041/SRS-DELIV-034', () => {
  it('разрешено из любой нетерминальной стадии, начиная с assigned', () => {
    expect(isReassignableStatus('assigned')).toBe(true)
    expect(isReassignableStatus('en_route_to_pharmacy')).toBe(true)
    expect(isReassignableStatus('picked_up_from_pharmacy')).toBe(true)
    expect(isReassignableStatus('en_route_to_customer')).toBe(true)
  })

  it('запрещено из unassigned (нечего переназначать) и терминальных состояний', () => {
    expect(isReassignableStatus('unassigned')).toBe(false)
    expect(isReassignableStatus('delivered')).toBe(false)
    expect(isReassignableStatus('delivery_failed')).toBe(false)
  })
})
