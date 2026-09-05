import { describe, expect, it } from 'vitest'
import { ActiveAssignmentBlocksShiftEndError, ShiftAlreadyActiveError } from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { fixedDate } from '@/modules/delivery/testing/fixtures/fixed-date.fixture.js'
import { CourierShift } from './courier-shift.entity.js'

const STARTED_AT = fixedDate('2026-08-27T08:00:00.000Z')
const ENDED_AT = fixedDate('2026-08-27T18:00:00.000Z')

function activeShift(openingCashDiram = 0n): CourierShift {
  return CourierShift.start({
    id: 'shift-1',
    courierId: 'courier-1',
    openingCashOnHandDiram: Money.fromDiram(openingCashDiram),
    hasActiveShift: false,
    now: STARTED_AT,
  })
}

describe('CourierShift.start() — SRS-DELIV-028, TC-DELIV-018', () => {
  it('успешно начинает active-смену', () => {
    const shift = activeShift()
    expect(shift.status).toBe('active')
    expect(shift.cashCollectedDiram.diram).toBe(0n)
  })

  it('TC-DELIV-018: hasActiveShift=true → ShiftAlreadyActiveError', () => {
    expect(() =>
      CourierShift.start({
        id: 'shift-2',
        courierId: 'courier-1',
        openingCashOnHandDiram: Money.fromDiram(0n),
        hasActiveShift: true,
        now: STARTED_AT,
      }),
    ).toThrow(ShiftAlreadyActiveError)
  })
})

describe('recordCashCollected()', () => {
  it('накапливает сумму по нескольким вызовам', () => {
    const shift = activeShift()
    shift.recordCashCollected(Money.fromDiram(6000n))
    shift.recordCashCollected(Money.fromDiram(4000n))
    expect(shift.cashCollectedDiram.diram).toBe(10000n)
  })
})

describe('restore()/toSnapshot() — round-trip', () => {
  it('восстановленная смена возвращает тот же снимок', () => {
    const shift = activeShift()
    shift.recordCashCollected(Money.fromDiram(1000n))
    const snapshot = shift.toSnapshot()
    expect(CourierShift.restore(snapshot).toSnapshot()).toEqual(snapshot)
  })
})

describe('close() — SRS-DELIV-029, TC-DELIV-019/020', () => {
  it('TC-DELIV-019: hasActiveAssignment=true → ActiveAssignmentBlocksShiftEndError', () => {
    const shift = activeShift()
    expect(() => { shift.close({
        cashSubmittedDiram: Money.fromDiram(0n),
        hasActiveAssignment: true,
        closedBy: null,
        now: ENDED_AT,
      }); },
    ).toThrow(ActiveAssignmentBlocksShiftEndError)
  })

  it('TC-DELIV-020: collected=10000, opening=0, submitted=9500 → discrepancy=500, эмитирует событие', () => {
    const shift = activeShift()
    shift.recordCashCollected(Money.fromDiram(10000n))
    shift.close({
      cashSubmittedDiram: Money.fromDiram(9500n),
      hasActiveAssignment: false,
      closedBy: 'courier-1',
      now: ENDED_AT,
    })
    expect(shift.status).toBe('closed')
    expect(shift.discrepancyDiram).toBe(500n)
    expect(shift.pullDomainEvents()).toEqual([
      { type: 'CashReconciliationDiscrepancyEvent', courierShiftId: 'shift-1', courierId: 'courier-1', discrepancyDiram: 500n },
    ])
  })

  it('discrepancy=0 — закрытие НЕ эмитирует CashReconciliationDiscrepancyEvent', () => {
    const shift = activeShift()
    shift.recordCashCollected(Money.fromDiram(6000n))
    shift.close({
      cashSubmittedDiram: Money.fromDiram(6000n),
      hasActiveAssignment: false,
      closedBy: 'courier-1',
      now: ENDED_AT,
    })
    expect(shift.discrepancyDiram).toBe(0n)
    expect(shift.pullDomainEvents()).toEqual([])
  })

  it('opening carried over from previous shift участвует в расчёте', () => {
    const shift = activeShift(1000n)
    shift.recordCashCollected(Money.fromDiram(6000n))
    shift.close({
      cashSubmittedDiram: Money.fromDiram(7000n),
      hasActiveAssignment: false,
      closedBy: null,
      now: ENDED_AT,
    })
    expect(shift.discrepancyDiram).toBe(0n) // 6000 + 1000 - 7000 = 0
  })

  it('discrepancy может быть отрицательной (курьер сдал больше)', () => {
    const shift = activeShift()
    shift.recordCashCollected(Money.fromDiram(6000n))
    shift.close({
      cashSubmittedDiram: Money.fromDiram(6500n),
      hasActiveAssignment: false,
      closedBy: null,
      now: ENDED_AT,
    })
    expect(shift.discrepancyDiram).toBe(-500n)
  })
})
