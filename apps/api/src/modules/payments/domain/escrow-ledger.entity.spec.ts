/**
 * `EscrowLedger.isBalanced` (EP-10, DTJ-240, SRS-PAY-010) — unit-тест формулы §4.1.
 * Тест-план тикета: сбалансированный / расхождение / только hold_created (заказ ещё не
 * доставлен) / пустой массив (не эскроу-заказ, тривиально «сбалансирован»).
 */
import { describe, expect, it } from 'vitest'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { EscrowLedger } from './escrow-ledger.entity.js'
import { EscrowLedgerEntry, type EscrowLedgerEntryProps } from './escrow-ledger-entry.value-object.js'

const ORDER_ID = 'order-1'

function entry(overrides: Partial<EscrowLedgerEntryProps>): EscrowLedgerEntry {
  return EscrowLedgerEntry.create({
    orderId: ORDER_ID,
    entryType: 'hold_created',
    direction: 'debit',
    amountDiram: Money.fromDiram(1n),
    paymentTransactionRef: null,
    reason: null,
    actorUserId: null,
    ...overrides,
  })
}

describe('EscrowLedger.isBalanced (DTJ-240, SRS-PAY-010)', () => {
  it('AC2 — hold=10000, platform_fee_captured=800, captured_to_pharmacy=9200 → true', () => {
    const entries = [
      entry({ entryType: 'hold_created', direction: 'debit', amountDiram: Money.fromDiram(10_000n) }),
      entry({ entryType: 'platform_fee_captured', direction: 'credit', amountDiram: Money.fromDiram(800n) }),
      entry({ entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: Money.fromDiram(9_200n) }),
    ]
    expect(EscrowLedger.isBalanced(entries)).toBe(true)
  })

  it('AC3 — captured_to_pharmacy=9000 (расхождение 200) → false', () => {
    const entries = [
      entry({ entryType: 'hold_created', direction: 'debit', amountDiram: Money.fromDiram(10_000n) }),
      entry({ entryType: 'platform_fee_captured', direction: 'credit', amountDiram: Money.fromDiram(800n) }),
      entry({ entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: Money.fromDiram(9_000n) }),
    ]
    expect(EscrowLedger.isBalanced(entries)).toBe(false)
  })

  it('только hold_created (заказ оплачен, ещё не доставлен) → false (буквальная формула, БЕЗ спецкейса-допуска)', () => {
    const entries = [entry({ entryType: 'hold_created', direction: 'debit', amountDiram: Money.fromDiram(10_000n) })]
    expect(EscrowLedger.isBalanced(entries)).toBe(false)
  })

  it('пустой массив (cash_courier, §4.6 — escrow_ledger пуст целиком) → true тривиально (0 === 0)', () => {
    expect(EscrowLedger.isBalanced([])).toBe(true)
  })

  it('полный возврат: hold=10000, refunded_to_customer=10000 → true', () => {
    const entries = [
      entry({ entryType: 'hold_created', direction: 'debit', amountDiram: Money.fromDiram(10_000n) }),
      entry({ entryType: 'refunded_to_customer', direction: 'credit', amountDiram: Money.fromDiram(10_000n) }),
    ]
    expect(EscrowLedger.isBalanced(entries)).toBe(true)
  })

  it('частичный возврат + capture: hold=10000, partially_refunded=2000, platform_fee=800, captured_to_pharmacy=7200 → true', () => {
    const entries = [
      entry({ entryType: 'hold_created', direction: 'debit', amountDiram: Money.fromDiram(10_000n) }),
      entry({ entryType: 'partially_refunded', direction: 'credit', amountDiram: Money.fromDiram(2_000n) }),
      entry({ entryType: 'platform_fee_captured', direction: 'credit', amountDiram: Money.fromDiram(800n) }),
      entry({ entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: Money.fromDiram(7_200n) }),
    ]
    expect(EscrowLedger.isBalanced(entries)).toBe(true)
  })

  it('adjustment credit увеличивает правую часть: hold=10000, captured=9000, adjustment credit=1000 → true', () => {
    const entries = [
      entry({ entryType: 'hold_created', direction: 'debit', amountDiram: Money.fromDiram(10_000n) }),
      entry({ entryType: 'platform_fee_captured', direction: 'credit', amountDiram: Money.fromDiram(800n) }),
      entry({ entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: Money.fromDiram(8_200n) }),
      entry({
        entryType: 'adjustment',
        direction: 'credit',
        amountDiram: Money.fromDiram(1_000n),
        reason: 'корректировка',
        actorUserId: 'admin-1',
      }),
    ]
    expect(EscrowLedger.isBalanced(entries)).toBe(true)
  })

  it('adjustment debit уменьшает правую часть: hold=10000, captured=9000+800, adjustment debit=800 → расходится, если не учтён', () => {
    const entries = [
      entry({ entryType: 'hold_created', direction: 'debit', amountDiram: Money.fromDiram(10_000n) }),
      entry({ entryType: 'platform_fee_captured', direction: 'credit', amountDiram: Money.fromDiram(800n) }),
      entry({ entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: Money.fromDiram(9_200n) }),
      entry({
        entryType: 'adjustment',
        direction: 'debit',
        amountDiram: Money.fromDiram(800n),
        reason: 'взыскание излишка',
        actorUserId: 'admin-1',
      }),
    ]
    // 10000 !== (800+9200) - 800 = 9200 → расхождение реальное, не 0.
    expect(EscrowLedger.isBalanced(entries)).toBe(false)
  })

  it('расхождение в 1 дирам — тоже false (нет допуска, раздел «Риски» тикета)', () => {
    const entries = [
      entry({ entryType: 'hold_created', direction: 'debit', amountDiram: Money.fromDiram(10_000n) }),
      entry({ entryType: 'platform_fee_captured', direction: 'credit', amountDiram: Money.fromDiram(800n) }),
      entry({ entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: Money.fromDiram(9_199n) }),
    ]
    expect(EscrowLedger.isBalanced(entries)).toBe(false)
  })
})
