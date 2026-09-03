/**
 * `EscrowLedgerEntry` (EP-10, DTJ-240) — unit-тест конструктора/фабрики.
 * Тест-план тикета: валидные/невалидные `adjustment`, `amountDiram <= 0`.
 */
import { describe, expect, it } from 'vitest'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { InvalidMoneyError } from '@/shared-kernel/domain/errors/invalid-money.error.js'
import { EscrowLedgerEntry, type EscrowLedgerEntryProps } from './escrow-ledger-entry.value-object.js'
import { AdjustmentRequiresReasonError } from './errors/adjustment-requires-reason.error.js'

const ORDER_ID = 'order-1'

function baseProps(overrides: Partial<EscrowLedgerEntryProps> = {}): EscrowLedgerEntryProps {
  return {
    orderId: ORDER_ID,
    entryType: 'hold_created',
    direction: 'debit',
    amountDiram: Money.fromDiram(10_000n),
    paymentTransactionRef: null,
    reason: null,
    actorUserId: null,
    ...overrides,
  }
}

describe('EscrowLedgerEntry.create (DTJ-240, SRS-DOM-031/067)', () => {
  it('создаёт валидную запись hold_created', () => {
    const entry = EscrowLedgerEntry.create(baseProps())
    expect(entry.orderId).toBe(ORDER_ID)
    expect(entry.entryType).toBe('hold_created')
    expect(entry.direction).toBe('debit')
    expect(entry.amountDiram.diram).toBe(10_000n)
    expect(entry.reason).toBeNull()
    expect(entry.actorUserId).toBeNull()
  })

  it('amountDiram <= 0 (ноль) — InvalidMoneyError (AC теста-плана)', () => {
    expect(() => EscrowLedgerEntry.create(baseProps({ amountDiram: Money.fromDiram(0n) }))).toThrow(
      InvalidMoneyError,
    )
  })

  it('Money сам отвергает отрицательный diram раньше конструктора EscrowLedgerEntry (SRS-DOM-067)', () => {
    expect(() => Money.fromDiram(-1n)).toThrow(InvalidMoneyError)
  })

  it('adjustment с непустыми reason/actorUserId — валиден (AC1 негативная зеркальная проверка)', () => {
    const entry = EscrowLedgerEntry.create(
      baseProps({
        entryType: 'adjustment',
        direction: 'credit',
        reason: 'спор урегулирован в пользу клиента',
        actorUserId: 'admin-1',
      }),
    )
    expect(entry.entryType).toBe('adjustment')
    expect(entry.reason).toBe('спор урегулирован в пользу клиента')
    expect(entry.actorUserId).toBe('admin-1')
  })

  it('AC1 — adjustment без reason → AdjustmentRequiresReasonError', () => {
    expect(() =>
      EscrowLedgerEntry.create(
        baseProps({ entryType: 'adjustment', direction: 'credit', reason: null, actorUserId: 'admin-1' }),
      ),
    ).toThrow(AdjustmentRequiresReasonError)
  })

  it('adjustment без actorUserId → AdjustmentRequiresReasonError', () => {
    expect(() =>
      EscrowLedgerEntry.create(
        baseProps({ entryType: 'adjustment', direction: 'credit', reason: 'x', actorUserId: null }),
      ),
    ).toThrow(AdjustmentRequiresReasonError)
  })

  it('adjustment с пустой строкой (не null) reason тоже отвергается — trim, не только null-проверка', () => {
    expect(() =>
      EscrowLedgerEntry.create(
        baseProps({ entryType: 'adjustment', direction: 'credit', reason: '   ', actorUserId: 'admin-1' }),
      ),
    ).toThrow(AdjustmentRequiresReasonError)
  })

  it('AdjustmentRequiresReasonError несёт orderId и код (SRS-DOM-035)', () => {
    try {
      EscrowLedgerEntry.create(
        baseProps({ entryType: 'adjustment', direction: 'debit', reason: null, actorUserId: null }),
      )
      throw new Error('expected to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(AdjustmentRequiresReasonError)
      const e = error as AdjustmentRequiresReasonError
      expect(e.orderId).toBe(ORDER_ID)
      expect(e.code).toBe('ADJUSTMENT_REQUIRES_REASON')
      expect(e.name).toBe('AdjustmentRequiresReasonError')
    }
  })

  it('НЕ-adjustment типы игнорируют пустые reason/actorUserId (правило применимо только к adjustment)', () => {
    const entry = EscrowLedgerEntry.create(baseProps({ entryType: 'captured_to_pharmacy', direction: 'credit' }))
    expect(entry.reason).toBeNull()
    expect(entry.actorUserId).toBeNull()
  })
})
