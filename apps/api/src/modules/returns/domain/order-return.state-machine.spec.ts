import { describe, expect, it } from 'vitest'
import type { ReturnStatus } from '@dorutj/contracts'
import { RETURN_ALLOWED_TRANSITIONS, isReturnTransitionAllowed } from './order-return.state-machine.js'

const ALL_STATUSES: readonly ReturnStatus[] = [
  'return_requested',
  'return_in_transit',
  'returned_to_pharmacy',
  'return_confirmed',
  'return_rejected',
]

describe('order-return.state-machine', () => {
  it('return_confirmed — терминален (нулевые исходящие рёбра, критерий приёмки 4 DTJ-271)', () => {
    expect(RETURN_ALLOWED_TRANSITIONS.return_confirmed).toEqual([])
  })

  it('returned_to_pharmacy — недостижим в R1 (нулевые исходящие И входящие рёбра, D-EP11-4)', () => {
    expect(RETURN_ALLOWED_TRANSITIONS.returned_to_pharmacy).toEqual([])
    for (const status of ALL_STATUSES) {
      expect(RETURN_ALLOWED_TRANSITIONS[status]).not.toContain('returned_to_pharmacy')
    }
  })

  it('return_rejected — НЕ терминален (SRS-DOM-056): есть исходящие рёбра в return_confirmed и return_in_transit', () => {
    expect(RETURN_ALLOWED_TRANSITIONS.return_rejected).toEqual(
      expect.arrayContaining(['return_confirmed', 'return_in_transit']),
    )
  })

  it.each(ALL_STATUSES.flatMap((from) => ALL_STATUSES.map((to) => [from, to] as const)))(
    'isReturnTransitionAllowed(%s, %s) совпадает с таблицей RETURN_ALLOWED_TRANSITIONS',
    (from, to) => {
      expect(isReturnTransitionAllowed(from, to)).toBe(RETURN_ALLOWED_TRANSITIONS[from].includes(to))
    },
  )
})
