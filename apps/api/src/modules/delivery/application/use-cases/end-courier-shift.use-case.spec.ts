/**
 * Unit-тест `EndCourierShiftUseCase` (EP-13, DTJ-320, тест-план тикета). Три случая расхождения
 * (положительное/отрицательное/нулевое) — событие публикуется ТОЛЬКО в первых двух (DoD).
 */
import { describe, expect, it, vi } from 'vitest'
import type { Clock } from '@/shared-kernel/index.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { Courier } from '../../domain/courier.entity.js'
import { CourierShift } from '../../domain/courier-shift.entity.js'
import { fixedDate } from '../../testing/fixtures/fixed-date.fixture.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { CourierShiftRepositoryPort } from '../ports/courier-shift.repository.port.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { EndCourierShiftUseCase } from './end-courier-shift.use-case.js'

const USER_ID = 'user-1'
const COURIER_ID = 'courier-1'
const OTHER_COURIER_ID = 'courier-OTHER'
const SHIFT_ID = 'shift-1'
const NOW = fixedDate('2026-01-15T20:00:00.000Z')

function makeCourier(): Courier {
  return Courier.create({
    id: COURIER_ID,
    userId: USER_ID,
    chainId: null,
    taxStatus: 'individual_patent',
    vehicleType: 'car',
    now: NOW,
  })
}

function makeActiveShift(params: { readonly courierId?: string; readonly openingDiram?: bigint; readonly cashCollectedDiram?: bigint } = {}): CourierShift {
  const shift = CourierShift.start({
    id: SHIFT_ID,
    courierId: params.courierId ?? COURIER_ID,
    openingCashOnHandDiram: Money.fromDiram(params.openingDiram ?? 0n),
    hasActiveShift: false,
    now: NOW,
  })
  if (params.cashCollectedDiram !== undefined) {
    shift.recordCashCollected(Money.fromDiram(params.cashCollectedDiram))
  }
  return shift
}

function makeUseCase(params: {
  readonly courier: Courier | null
  readonly shift: CourierShift | null
  readonly hasActiveAssignment: boolean
}): { useCase: EndCourierShiftUseCase; outboxAppend: ReturnType<typeof vi.fn>; shiftsSave: ReturnType<typeof vi.fn> } {
  const shiftsSave = vi.fn().mockResolvedValue(undefined)
  const outboxAppend = vi.fn().mockResolvedValue(undefined)
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.courier),
    findByUserId: vi.fn().mockResolvedValue(params.courier),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const shifts: CourierShiftRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.shift),
    findActiveByCourierId: vi.fn().mockResolvedValue(params.shift),
    save: shiftsSave,
  }
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(params.hasActiveAssignment),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const outbox: DeliveryOutboxPort = { append: outboxAppend }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const clock: Clock = { now: () => NOW }
  return {
    useCase: new EndCourierShiftUseCase(couriers, shifts, assignments, outbox, uow, clock),
    outboxAppend,
    shiftsSave,
  }
}

describe('EndCourierShiftUseCase', () => {
  it('TC-DELIV-019: активное назначение блокирует закрытие смены (422 ActiveAssignmentBlocksShiftEndError)', async () => {
    const shift = makeActiveShift()
    const { useCase, shiftsSave } = makeUseCase({ courier: makeCourier(), shift, hasActiveAssignment: true })

    await expect(
      useCase.execute({ userId: USER_ID, shiftId: SHIFT_ID, cashSubmittedDiram: 0n }),
    ).rejects.toThrow(/active/i)
    expect(shiftsSave).not.toHaveBeenCalled()
  })

  it('TC-DELIV-020: discrepancy=500 (collected=10000, opening=0, submitted=9500) публикует CashReconciliationDiscrepancyEvent', async () => {
    const shift = makeActiveShift({ openingDiram: 0n, cashCollectedDiram: 10_000n })
    const { useCase, outboxAppend } = makeUseCase({ courier: makeCourier(), shift, hasActiveAssignment: false })

    const snapshot = await useCase.execute({ userId: USER_ID, shiftId: SHIFT_ID, cashSubmittedDiram: 9_500n })

    expect(snapshot.discrepancyDiram).toBe(500n)
    expect(snapshot.status).toBe('closed')
    expect(outboxAppend).toHaveBeenCalledTimes(1)
    const [publishedEvent] = outboxAppend.mock.calls[0] as [unknown]
    expect(publishedEvent).toMatchObject({
      type: 'CashReconciliationDiscrepancyEvent',
      courierShiftId: SHIFT_ID,
      courierId: COURIER_ID,
      discrepancyDiram: 500n,
    })
  })

  it('расхождение ОТРИЦАТЕЛЬНОЕ (курьер сдал больше) тоже публикует событие', async () => {
    const shift = makeActiveShift({ openingDiram: 0n, cashCollectedDiram: 1_000n })
    const { useCase, outboxAppend } = makeUseCase({ courier: makeCourier(), shift, hasActiveAssignment: false })

    const snapshot = await useCase.execute({ userId: USER_ID, shiftId: SHIFT_ID, cashSubmittedDiram: 1_500n })

    expect(snapshot.discrepancyDiram).toBe(-500n)
    expect(outboxAppend).toHaveBeenCalledTimes(1)
  })

  it('discrepancy=0 НЕ публикует событие (иначе audit_log захламляется нулевыми "расхождениями")', async () => {
    const shift = makeActiveShift({ openingDiram: 0n, cashCollectedDiram: 2_000n })
    const { useCase, outboxAppend } = makeUseCase({ courier: makeCourier(), shift, hasActiveAssignment: false })

    const snapshot = await useCase.execute({ userId: USER_ID, shiftId: SHIFT_ID, cashSubmittedDiram: 2_000n })

    expect(snapshot.discrepancyDiram).toBe(0n)
    expect(outboxAppend).not.toHaveBeenCalled()
  })

  it('успешное закрытие: couriers.shift_status=off_shift, current_cash_on_hand_diram=0', async () => {
    const shift = makeActiveShift({ openingDiram: 0n, cashCollectedDiram: 2_000n })
    const couriers: CourierRepositoryPort = {
      findById: vi.fn().mockResolvedValue(makeCourier()),
      findByUserId: vi.fn().mockResolvedValue(makeCourier()),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const shifts: CourierShiftRepositoryPort = {
      findById: vi.fn().mockResolvedValue(shift),
      findActiveByCourierId: vi.fn().mockResolvedValue(shift),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const assignments: DeliveryAssignmentRepositoryPort = {
      findById: vi.fn().mockResolvedValue(null),
      findActiveByOrderId: vi.fn().mockResolvedValue(null),
      findByOrderId: vi.fn().mockResolvedValue(null),
      hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const outbox: DeliveryOutboxPort = { append: vi.fn().mockResolvedValue(undefined) }
    const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
    const clock: Clock = { now: () => NOW }
    const useCase = new EndCourierShiftUseCase(couriers, shifts, assignments, outbox, uow, clock)

    await useCase.execute({ userId: USER_ID, shiftId: SHIFT_ID, cashSubmittedDiram: 2_000n })

    const savedCourier = (couriers.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Courier
    expect(savedCourier.shiftStatus).toBe('off_shift')
    expect(savedCourier.currentCashOnHandDiram.diram).toBe(0n)
  })

  it('чужая смена (shift.courierId !== resolvedCourier.id) -> ForbiddenError', async () => {
    const shift = makeActiveShift({ courierId: OTHER_COURIER_ID })
    const { useCase } = makeUseCase({ courier: makeCourier(), shift, hasActiveAssignment: false })

    await expect(
      useCase.execute({ userId: USER_ID, shiftId: SHIFT_ID, cashSubmittedDiram: 0n }),
    ).rejects.toThrow('does not belong to the requesting courier')
  })

  it('смена не найдена -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ courier: makeCourier(), shift: null, hasActiveAssignment: false })
    await expect(
      useCase.execute({ userId: USER_ID, shiftId: 'unknown-shift', cashSubmittedDiram: 0n }),
    ).rejects.toThrow()
  })
})
