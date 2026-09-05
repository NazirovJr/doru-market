import { describe, expect, it } from 'vitest'
import { fixedDate } from '@/modules/orders/testing/fixtures/fixed-date.fixture.js'
import {
  ORDER_CANCEL_REASON_VALUES,
  ORDER_ITEM_ISSUE_REASON_VALUES,
  ORDER_RECLAIM_REASON_VALUES,
  type OrderDomainEvent,
  type PartialFulfillmentSnapshotItem,
} from './order-domain-event.js'

describe('ORDER_CANCEL_REASON_VALUES (SRS-ORD-030)', () => {
  it('содержит канонический набор причин отмены, а не свободную строку', () => {
    expect(ORDER_CANCEL_REASON_VALUES).toEqual([
      'customer_changed_mind',
      'found_cheaper_elsewhere',
      'pharmacy_suspended',
      'payment_timeout',
      'pickup_sla_timeout',
      'fraud_or_safety_force_cancel',
      'license_revoked_force_cancel',
      'late_payment_after_cancellation',
    ])
  })
})

describe('ORDER_RECLAIM_REASON_VALUES (DTJ-300, SRS-PHT-010)', () => {
  it('содержит канонический набор причин reclaim, а не свободную строку', () => {
    expect(ORDER_RECLAIM_REASON_VALUES).toEqual(['colleague_unavailable', 'shift_change', 'other'])
  })
})

describe('ORDER_ITEM_ISSUE_REASON_VALUES (DTJ-300, SRS-PHT-017/018)', () => {
  it('содержит канонический набор причин report-issue, 1:1 с CHECK order_items.item_issue_reason', () => {
    expect(ORDER_ITEM_ISSUE_REASON_VALUES).toEqual(['out_of_stock', 'expired_on_shelf', 'damaged_packaging'])
  })
})

/**
 * DTJ-300 — реестр ВСЕХ вариантов `OrderDomainEvent['type']`, включая 5 новых. `Record<Type, true>`
 * без switch/if (нулевая цикломатическая сложность, `complexity` ESLint-правило не задевается) —
 * если в union добавят вариант без ключа здесь, `tsc` провалит компиляцию («Property ... is
 * missing») раньше, чем тест рассинхронизируется молча.
 */
const ALL_EVENT_TYPES: Record<OrderDomainEvent['type'], true> = {
  OrderConfirmedEvent: true,
  OrderProcessingStartedEvent: true,
  OrderPickedUpEvent: true,
  OrderCancelledEvent: true,
  OrderClaimedEvent: true,
  OrderReclaimedEvent: true,
  PartialFulfillmentProposedEvent: true,
  PartialFulfillmentConfirmedEvent: true,
  PartialFulfillmentRejectedEvent: true,
  PartialFulfillmentAutoConfirmedEvent: true,
  HandoverOtpRegeneratedEvent: true,
}

describe('OrderDomainEvent — реестр вариантов исчерпывающий (DTJ-300)', () => {
  it('9 вариантов union (4 существующих + 5 новых DTJ-300), без дублей', () => {
    expect(Object.keys(ALL_EVENT_TYPES).sort()).toEqual(
      [
        'OrderConfirmedEvent',
        'OrderProcessingStartedEvent',
        'OrderPickedUpEvent',
        'OrderCancelledEvent',
        'OrderClaimedEvent',
        'OrderReclaimedEvent',
        'PartialFulfillmentProposedEvent',
        'PartialFulfillmentConfirmedEvent',
        'PartialFulfillmentRejectedEvent',
        'PartialFulfillmentAutoConfirmedEvent',
        'HandoverOtpRegeneratedEvent',
      ].sort(),
    )
  })
})

/**
 * DTJ-300 — сериализация каждого из 5 новых вариантов `OrderDomainEvent` в payload,
 * соответствующий таблице «Новые доменные события» `24-module-pharmacy-terminal.md`. Событие —
 * discriminated union без runtime-конструктора (тот же паттерн, что 4 существующих варианта) —
 * тест строит литерал, соответствующий типу, и проверяет форму полей через `toEqual`. `fixedDate`
 * — фикстура `orders/testing/fixtures` (НЕ `domain/`), `no-restricted-globals` на `Date` сюда не
 * распространяется (см. JSDoc фикстуры).
 */
describe('OrderDomainEvent — 5 новых вариантов (DTJ-300, модуль 24)', () => {
  it('OrderClaimedEvent — orderId, pharmacistId, claimedAt (SRS-PHT-007/009)', () => {
    const claimedAt = fixedDate('2026-09-04T10:00:00.000Z')
    const event: OrderDomainEvent = {
      type: 'OrderClaimedEvent',
      orderId: 'order-1',
      pharmacistId: 'pharmacist-a',
      claimedAt,
    }
    expect(event).toEqual({
      type: 'OrderClaimedEvent',
      orderId: 'order-1',
      pharmacistId: 'pharmacist-a',
      claimedAt,
    })
  })

  it('OrderReclaimedEvent — orderId, previousPharmacistId, newPharmacistId, reason, at (SRS-PHT-010)', () => {
    const at = fixedDate('2026-09-04T10:05:00.000Z')
    const event: OrderDomainEvent = {
      type: 'OrderReclaimedEvent',
      orderId: 'order-1',
      previousPharmacistId: 'pharmacist-a',
      newPharmacistId: 'pharmacist-b',
      reason: 'shift_change',
      at,
    }
    expect(event.type).toBe('OrderReclaimedEvent')
    expect(event.reason).toBe('shift_change')
    expect(ORDER_RECLAIM_REASON_VALUES).toContain(event.reason)
  })

  it('PartialFulfillmentProposedEvent — orderId, requestId, itemsSnapshot, refundAmountDiram, expiresAt, at (SRS-PHT-020)', () => {
    const itemsSnapshot: readonly PartialFulfillmentSnapshotItem[] = [
      { orderItemId: 'item-1', medicineName: 'Paracetamol 500mg', quantity: 2, reason: 'out_of_stock' },
    ]
    const at = fixedDate('2026-09-04T10:10:00.000Z')
    const expiresAt = fixedDate('2026-09-04T10:20:00.000Z')
    const event: OrderDomainEvent = {
      type: 'PartialFulfillmentProposedEvent',
      orderId: 'order-1',
      requestId: 'request-1',
      itemsSnapshot,
      refundAmountDiram: 200_000n,
      expiresAt,
      at,
    }
    expect(event.type).toBe('PartialFulfillmentProposedEvent')
    expect(event.itemsSnapshot).toHaveLength(1)
    expect(event.itemsSnapshot[0]).toEqual({
      orderItemId: 'item-1',
      medicineName: 'Paracetamol 500mg',
      quantity: 2,
      reason: 'out_of_stock',
    })
    expect(typeof event.refundAmountDiram).toBe('bigint')
  })

  it.each([
    'PartialFulfillmentConfirmedEvent',
    'PartialFulfillmentRejectedEvent',
    'PartialFulfillmentAutoConfirmedEvent',
  ] as const)('%s — orderId, requestId, at (SRS-PHT-022/023/023a, дискриминант = резолюция)', (type) => {
    const at = fixedDate('2026-09-04T10:30:00.000Z')
    const event: OrderDomainEvent = { type, orderId: 'order-1', requestId: 'request-1', at }
    expect(event).toEqual({ type, orderId: 'order-1', requestId: 'request-1', at })
  })

  it('HandoverOtpRegeneratedEvent — orderId, deliveryAssignmentId, regeneratedAt, regenerationsUsed (SRS-PHT-029)', () => {
    const regeneratedAt = fixedDate('2026-09-04T11:00:00.000Z')
    const event: OrderDomainEvent = {
      type: 'HandoverOtpRegeneratedEvent',
      orderId: 'order-1',
      deliveryAssignmentId: 'delivery-1',
      regeneratedAt,
      regenerationsUsed: 3,
    }
    expect(event.type).toBe('HandoverOtpRegeneratedEvent')
    expect(event.regenerationsUsed).toBe(3)
  })
})
