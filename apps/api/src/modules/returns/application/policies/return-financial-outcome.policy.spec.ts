import { describe, expect, it } from 'vitest'
import type { ReturnReason as ReturnReasonValue } from '@dorutj/contracts'
import { ReturnReason, ReturnDisposition, UnsupportedReturnReasonError } from '../../domain/index.js'
import { ReturnFinancialOutcomeResolver } from './return-financial-outcome.policy.js'
import type { ReturnFinancialOutcome } from './return-financial-outcome.types.js'

const resolver = new ReturnFinancialOutcomeResolver()

/** Таблица SRS-RET-004 — все причины со СТАТИЧЕСКИМ исходом (без customer_dispute_post_delivery/undelivered). */
const STATIC_TABLE: readonly [ReturnReasonValue, ReturnFinancialOutcome][] = [
  ['defect', { itemsRefund: 'full', deliveryFeeRefund: 'full', courierReturnFeeApplies: true }],
  ['wrong_item', { itemsRefund: 'full', deliveryFeeRefund: 'full', courierReturnFeeApplies: true }],
  ['damaged_packaging', { itemsRefund: 'full', deliveryFeeRefund: 'full', courierReturnFeeApplies: true }],
  ['expired_or_near_expiry', { itemsRefund: 'full', deliveryFeeRefund: 'full', courierReturnFeeApplies: true }],
  ['refused_at_door', { itemsRefund: 'full', deliveryFeeRefund: 'none', courierReturnFeeApplies: true }],
  ['undeliverable', { itemsRefund: 'full', deliveryFeeRefund: 'none', courierReturnFeeApplies: true }],
]

describe('ReturnFinancialOutcomeResolver.resolve() — таблица SRS-RET-004', () => {
  it.each(STATIC_TABLE)('reason=%s → %o (аналог TC-RET-002/003)', (reasonValue, expected) => {
    const outcome = resolver.resolve(ReturnReason.fromTrusted(reasonValue), null)
    expect(outcome).toEqual(expected)
  })

  it("reason='defect' → полный набор { itemsRefund: 'full', deliveryFeeRefund: 'full', courierReturnFeeApplies: true } (TC-RET-002)", () => {
    const outcome = resolver.resolve(ReturnReason.fromTrusted('defect'), null)
    expect(outcome).toEqual({ itemsRefund: 'full', deliveryFeeRefund: 'full', courierReturnFeeApplies: true })
  })

  it("reason='refused_at_door' → deliveryFeeRefund='none', itemsRefund='full' (TC-RET-003)", () => {
    const outcome = resolver.resolve(ReturnReason.fromTrusted('refused_at_door'), null)
    expect(outcome.deliveryFeeRefund).toBe('none')
    expect(outcome.itemsRefund).toBe('full')
  })

  it("reason='customer_dispute_post_delivery', disposition='restock' → itemsRefund/deliveryFeeRefund='full' (подтверждённый брак)", () => {
    const outcome = resolver.resolve(ReturnReason.fromTrusted('customer_dispute_post_delivery'), ReturnDisposition.restock())
    expect(outcome.itemsRefund).toBe('full')
    expect(outcome.deliveryFeeRefund).toBe('full')
  })

  it("reason='customer_dispute_post_delivery', disposition='destroy' → без возврата денег", () => {
    const outcome = resolver.resolve(ReturnReason.fromTrusted('customer_dispute_post_delivery'), ReturnDisposition.destroy())
    expect(outcome.itemsRefund).toBe('none')
    expect(outcome.deliveryFeeRefund).toBe('none')
  })

  it("reason='customer_dispute_post_delivery', disposition=null (ещё не решено) → без возврата денег", () => {
    const outcome = resolver.resolve(ReturnReason.fromTrusted('customer_dispute_post_delivery'), null)
    expect(outcome.itemsRefund).toBe('none')
    expect(outcome.deliveryFeeRefund).toBe('none')
  })

  it("reason='undelivered' — бросает UnsupportedReturnReasonError (резолвер не угадывает исход для чужой причины)", () => {
    expect(() => resolver.resolve(ReturnReason.fromTrusted('undelivered'), null)).toThrow(UnsupportedReturnReasonError)
  })

  it('courierReturnFeeApplies=true для ЛЮБОГО валидного reason (SRS-RET-005) — отдельная проверка, не совпадение с другими полями', () => {
    const allResolvableReasons = [
      'defect',
      'wrong_item',
      'damaged_packaging',
      'expired_or_near_expiry',
      'refused_at_door',
      'undeliverable',
    ] as const
    for (const reasonValue of allResolvableReasons) {
      const outcome = resolver.resolve(ReturnReason.fromTrusted(reasonValue), null)
      expect(outcome.courierReturnFeeApplies).toBe(true)
    }
    expect(resolver.resolve(ReturnReason.fromTrusted('customer_dispute_post_delivery'), ReturnDisposition.restock()).courierReturnFeeApplies).toBe(
      true,
    )
  })
})
