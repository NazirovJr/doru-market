import { describe, expect, it } from 'vitest'
import type { PharmacyTerminalOrderItemDto } from '@dorutj/contracts'
import {
  canCompletePicking,
  canProposePartialFulfillment,
  derivePartialFulfillmentUiStatus,
  type PartialFulfillmentUiStatus,
} from './partial-fulfillment.model'

function makeItem(overrides: Partial<PharmacyTerminalOrderItemDto> & { readonly id: string }): PharmacyTerminalOrderItemDto {
  return {
    orderId: 'order-1',
    medicineId: 'med-1',
    medicineName: 'Парацетамол 500мг',
    unitPriceDiram: 1000,
    quantity: 1,
    totalPriceDiram: 1000,
    commissionBps: 500,
    platformFeeDiram: 50,
    fulfillmentStatus: 'pending',
    scannedBatchId: null,
    scannedAt: null,
    scannedBy: null,
    scanMethod: null,
    itemIssueReason: null,
    ...overrides,
  }
}

describe('partial-fulfillment.model — derivePartialFulfillmentUiStatus', () => {
  it('null (частичная сборка ни разу не предлагалась) — idle', () => {
    expect(derivePartialFulfillmentUiStatus(null)).toBe('idle')
  })

  it('status=awaiting_customer — awaiting', () => {
    expect(derivePartialFulfillmentUiStatus({ status: 'awaiting_customer', requestedAt: '2026-09-27T10:00:00.000Z', expiresAt: '2026-09-27T10:10:00.000Z' })).toBe(
      'awaiting',
    )
  })

  it.each(['confirmed', 'auto_confirmed_timeout', 'rejected'] as const)('status=%s — resolved', (status) => {
    expect(derivePartialFulfillmentUiStatus({ status, requestedAt: '2026-09-27T10:00:00.000Z', expiresAt: '2026-09-27T10:10:00.000Z' })).toBe('resolved')
  })
})

describe('partial-fulfillment.model — canProposePartialFulfillment', () => {
  it('все решены + есть unavailable + idle — можно предложить', () => {
    const items = [makeItem({ id: 'a', fulfillmentStatus: 'unavailable' }), makeItem({ id: 'b', fulfillmentStatus: 'scanned_ok' })]
    expect(canProposePartialFulfillment(items, 'idle')).toBe(true)
  })

  it('есть pending-позиция — нельзя предложить, даже если уже есть unavailable', () => {
    const items = [makeItem({ id: 'a', fulfillmentStatus: 'unavailable' }), makeItem({ id: 'b', fulfillmentStatus: 'pending' })]
    expect(canProposePartialFulfillment(items, 'idle')).toBe(false)
  })

  it('нет unavailable-позиций — нечего предлагать', () => {
    const items = [makeItem({ id: 'a', fulfillmentStatus: 'scanned_ok' })]
    expect(canProposePartialFulfillment(items, 'idle')).toBe(false)
  })

  it('уже awaiting — повторное предложение недоступно', () => {
    const items = [makeItem({ id: 'a', fulfillmentStatus: 'unavailable' })]
    expect(canProposePartialFulfillment(items, 'awaiting')).toBe(false)
  })
})

describe('partial-fulfillment.model — canCompletePicking (таблица истинности)', () => {
  interface Case {
    readonly label: string
    readonly itemOverrides: readonly Partial<PharmacyTerminalOrderItemDto>[]
    readonly status: PartialFulfillmentUiStatus
    readonly expected: boolean
  }

  const CASES: readonly Case[] = [
    { label: 'есть pending, нет unavailable, idle', itemOverrides: [{ fulfillmentStatus: 'pending' }], status: 'idle', expected: false },
    { label: 'все решены, нет unavailable, idle', itemOverrides: [{ fulfillmentStatus: 'scanned_ok' }], status: 'idle', expected: true },
    { label: 'все решены, есть unavailable, idle (клиент ещё не спрошен)', itemOverrides: [{ fulfillmentStatus: 'unavailable' }], status: 'idle', expected: false },
    { label: 'все решены, есть unavailable, awaiting (ждём клиента)', itemOverrides: [{ fulfillmentStatus: 'unavailable' }], status: 'awaiting', expected: false },
    { label: 'все решены, есть unavailable, resolved (клиент подтвердил)', itemOverrides: [{ fulfillmentStatus: 'unavailable' }], status: 'resolved', expected: true },
    {
      label: 'есть pending, есть unavailable, resolved — pending всё равно блокирует',
      itemOverrides: [{ fulfillmentStatus: 'pending' }, { fulfillmentStatus: 'unavailable' }],
      status: 'resolved',
      expected: false,
    },
  ]

  it.each(CASES)('$label', ({ itemOverrides, status, expected }) => {
    const items = itemOverrides.map((overrides, index) => makeItem({ id: `item-${String(index)}`, ...overrides }))
    expect(canCompletePicking(items, status)).toBe(expected)
  })
})
