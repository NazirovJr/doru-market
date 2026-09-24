/**
 * Unit-тест `StartCourierShiftUseCase` (EP-13, DTJ-320, тест-план тикета).
 */
import { describe, expect, it, vi } from 'vitest'
import type { Clock, IdGenerator } from '@/shared-kernel/index.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { Courier } from '../../domain/courier.entity.js'
import { CourierShift } from '../../domain/courier-shift.entity.js'
import { fixedDate } from '../../testing/fixtures/fixed-date.fixture.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { CourierShiftRepositoryPort } from '../ports/courier-shift.repository.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { StartCourierShiftUseCase } from './start-courier-shift.use-case.js'

const USER_ID = 'user-1'
const COURIER_ID = 'courier-1'
const NEW_SHIFT_ID = 'shift-new'
const NOW = fixedDate('2026-01-15T08:00:00.000Z')

function makeCourier(overrides: { readonly currentCashOnHandDiram?: bigint } = {}): Courier {
  const courier = Courier.create({
    id: COURIER_ID,
    userId: USER_ID,
    chainId: null,
    taxStatus: 'individual_patent',
    vehicleType: 'car',
    now: NOW,
  })
  if (overrides.currentCashOnHandDiram === undefined) {
    return courier
  }
  return Courier.restore({ ...courier.props, currentCashOnHandDiram: Money.fromDiram(overrides.currentCashOnHandDiram) })
}

function makeUseCase(params: { readonly courier: Courier | null; readonly activeShift: CourierShift | null }): {
  useCase: StartCourierShiftUseCase
  shiftsSave: ReturnType<typeof vi.fn>
  couriersSave: ReturnType<typeof vi.fn>
} {
  const shiftsSave = vi.fn().mockResolvedValue(undefined)
  const couriersSave = vi.fn().mockResolvedValue(undefined)
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.courier),
    findByUserId: vi.fn().mockResolvedValue(params.courier),
    save: couriersSave,
  }
  const shifts: CourierShiftRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findActiveByCourierId: vi.fn().mockResolvedValue(params.activeShift),
    save: shiftsSave,
  }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const ids: IdGenerator = { next: vi.fn(() => NEW_SHIFT_ID) }
  const clock: Clock = { now: () => NOW }
  return { useCase: new StartCourierShiftUseCase(couriers, shifts, uow, ids, clock), shiftsSave, couriersSave }
}

describe('StartCourierShiftUseCase', () => {
  it('переносит opening_cash_on_hand_diram из остатка предыдущей смены (couriers.current_cash_on_hand_diram)', async () => {
    const courier = makeCourier({ currentCashOnHandDiram: 1500n })
    const { useCase, shiftsSave } = makeUseCase({ courier, activeShift: null })

    const snapshot = await useCase.execute(USER_ID)

    expect(snapshot.openingCashOnHandDiram.diram).toBe(1500n)
    expect(snapshot.status).toBe('active')
    expect(snapshot.courierId).toBe(COURIER_ID)
    expect(shiftsSave).toHaveBeenCalledTimes(1)
  })

  it('переводит couriers.shift_status в on_shift (Courier.goOnShift())', async () => {
    const courier = makeCourier()
    const { useCase, couriersSave } = makeUseCase({ courier, activeShift: null })

    await useCase.execute(USER_ID)

    expect(couriersSave).toHaveBeenCalledTimes(1)
    const savedCourier = couriersSave.mock.calls[0]?.[0] as Courier
    expect(savedCourier.shiftStatus).toBe('on_shift')
  })

  it('TC-DELIV-018: активная смена уже есть -> ShiftAlreadyActiveError (409 по ERROR_HTTP_STATUS)', async () => {
    const courier = makeCourier()
    const activeShift = CourierShift.start({
      id: 'shift-existing',
      courierId: COURIER_ID,
      openingCashOnHandDiram: Money.fromDiram(0n),
      hasActiveShift: false,
      now: NOW,
    })
    const { useCase, shiftsSave } = makeUseCase({ courier, activeShift })

    await expect(useCase.execute(USER_ID)).rejects.toThrow('Courier already has an active shift')
    expect(shiftsSave).not.toHaveBeenCalled()
  })

  it('курьер не найден по userId -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ courier: null, activeShift: null })
    await expect(useCase.execute('unknown-user')).rejects.toThrow()
  })
})
