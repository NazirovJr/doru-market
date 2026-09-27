import { describe, expect, it } from 'vitest'
import type { OrderDto, PharmacyTerminalOrderItemDto } from '@dorutj/contracts'
import {
  canCompletePicking,
  canProposePartialFulfillment,
  resolvePartialFulfillmentUiState,
  type PartialFulfillmentUiState,
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

const IDLE: PartialFulfillmentUiState = { kind: 'idle' }
const AWAITING: PartialFulfillmentUiState = { kind: 'awaiting', totalBeforeDiram: 1000 }
const RESOLVED: PartialFulfillmentUiState = { kind: 'resolved' }

describe('partial-fulfillment.model — canProposePartialFulfillment', () => {
  it('все решены + есть unavailable + idle — можно предложить', () => {
    const items = [makeItem({ id: 'a', fulfillmentStatus: 'unavailable' }), makeItem({ id: 'b', fulfillmentStatus: 'scanned_ok' })]
    expect(canProposePartialFulfillment(items, IDLE)).toBe(true)
  })

  it('есть pending-позиция — нельзя предложить, даже если уже есть unavailable', () => {
    const items = [makeItem({ id: 'a', fulfillmentStatus: 'unavailable' }), makeItem({ id: 'b', fulfillmentStatus: 'pending' })]
    expect(canProposePartialFulfillment(items, IDLE)).toBe(false)
  })

  it('нет unavailable-позиций — нечего предлагать', () => {
    const items = [makeItem({ id: 'a', fulfillmentStatus: 'scanned_ok' })]
    expect(canProposePartialFulfillment(items, IDLE)).toBe(false)
  })

  it('уже awaiting — повторное предложение недоступно', () => {
    const items = [makeItem({ id: 'a', fulfillmentStatus: 'unavailable' })]
    expect(canProposePartialFulfillment(items, AWAITING)).toBe(false)
  })
})

interface CanCompletePickingCase {
  readonly label: string
  readonly itemOverrides: readonly Partial<PharmacyTerminalOrderItemDto>[]
  readonly uiState: PartialFulfillmentUiState
  readonly expected: boolean
}

const CAN_COMPLETE_PICKING_CASES: readonly CanCompletePickingCase[] = [
  { label: 'есть pending, нет unavailable, idle', itemOverrides: [{ fulfillmentStatus: 'pending' }], uiState: IDLE, expected: false },
  { label: 'все решены, нет unavailable, idle', itemOverrides: [{ fulfillmentStatus: 'scanned_ok' }], uiState: IDLE, expected: true },
  { label: 'все решены, есть unavailable, idle (клиент ещё не спрошен)', itemOverrides: [{ fulfillmentStatus: 'unavailable' }], uiState: IDLE, expected: false },
  { label: 'все решены, есть unavailable, awaiting (ждём клиента)', itemOverrides: [{ fulfillmentStatus: 'unavailable' }], uiState: AWAITING, expected: false },
  { label: 'все решены, есть unavailable, resolved (клиент подтвердил)', itemOverrides: [{ fulfillmentStatus: 'unavailable' }], uiState: RESOLVED, expected: true },
  {
    label: 'есть pending, есть unavailable, resolved — pending всё равно блокирует',
    itemOverrides: [{ fulfillmentStatus: 'pending' }, { fulfillmentStatus: 'unavailable' }],
    uiState: RESOLVED,
    expected: false,
  },
]

describe('partial-fulfillment.model — canCompletePicking (таблица истинности)', () => {
  it.each(CAN_COMPLETE_PICKING_CASES)('$label', ({ itemOverrides, uiState, expected }) => {
    const items = itemOverrides.map((overrides, index) => makeItem({ id: `item-${String(index)}`, ...overrides }))
    expect(canCompletePicking(items, uiState)).toBe(expected)
  })
})

function makeOrder(overrides: Partial<Pick<OrderDto, 'status' | 'totalAmountDiram'>>): Pick<OrderDto, 'status' | 'totalAmountDiram'> {
  return { status: 'processing', totalAmountDiram: 1000, ...overrides }
}

describe('partial-fulfillment.model — resolvePartialFulfillmentUiState', () => {
  it('idle — не меняется опросом заказа', () => {
    expect(resolvePartialFulfillmentUiState(IDLE, makeOrder({ totalAmountDiram: 500 }))).toBe(IDLE)
  })

  it('awaiting, сумма не уменьшилась — остаётся awaiting (клиент ещё не ответил)', () => {
    expect(resolvePartialFulfillmentUiState(AWAITING, makeOrder({ totalAmountDiram: 1000 }))).toEqual(AWAITING)
  })

  it('awaiting, сумма уменьшилась — resolved (подтверждено/авто-подтверждено, SRS-PHT-022)', () => {
    expect(resolvePartialFulfillmentUiState(AWAITING, makeOrder({ totalAmountDiram: 700 }))).toEqual({ kind: 'resolved' })
  })

  it('awaiting, заказ отменён клиентом (отказ) — не resolved, этот случай берёт на себя OrderCancelledDialog', () => {
    expect(resolvePartialFulfillmentUiState(AWAITING, makeOrder({ status: 'cancelled', totalAmountDiram: 1000 }))).toEqual(AWAITING)
  })
})
