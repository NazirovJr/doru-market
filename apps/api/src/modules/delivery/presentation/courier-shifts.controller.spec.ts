import { describe, expect, it, vi } from 'vitest'
import type { JwtClaims } from '@/modules/auth/index.js'
import type { StartCourierShiftUseCase } from '../application/use-cases/start-courier-shift.use-case.js'
import type { EndCourierShiftUseCase } from '../application/use-cases/end-courier-shift.use-case.js'
import { CourierShiftsController } from './courier-shifts.controller.js'

const COURIER_CLAIMS: JwtClaims = { sub: 'user-1', role: 'courier', tenantId: 'tenant-1', pharmacyId: null, chainId: null, sessionId: 's-1' }

const SNAPSHOT = {
  id: 'shift-1',
  courierId: 'courier-1',
  status: 'active' as const,
  startedAt: new Date('2026-09-06T08:00:00.000Z'),
  endedAt: null,
  openingCashOnHandDiram: { diram: 0n },
  cashCollectedDiram: { diram: 0n },
  cashSubmittedDiram: null,
  discrepancyDiram: null,
}

function fakeUseCases(): {
  start: StartCourierShiftUseCase
  end: EndCourierShiftUseCase
  startExecute: ReturnType<typeof vi.fn>
  endExecute: ReturnType<typeof vi.fn>
} {
  const startExecute = vi.fn().mockResolvedValue(SNAPSHOT)
  const endExecute = vi.fn().mockResolvedValue({ ...SNAPSHOT, status: 'closed', cashSubmittedDiram: { diram: 0n }, discrepancyDiram: 0n })
  return {
    start: { execute: startExecute } as unknown as StartCourierShiftUseCase,
    end: { execute: endExecute } as unknown as EndCourierShiftUseCase,
    startExecute,
    endExecute,
  }
}

describe('CourierShiftsController', () => {
  it('start: делегирует StartCourierShiftUseCase.execute(userId из JWT), маппит Money -> number', async () => {
    const { start, end, startExecute } = fakeUseCases()
    const controller = new CourierShiftsController(start, end)

    const response = await controller.start(COURIER_CLAIMS)

    expect(startExecute).toHaveBeenCalledWith('user-1')
    expect(response.data).toMatchObject({ id: 'shift-1', courierId: 'courier-1', status: 'active', openingCashOnHandDiram: 0 })
  })

  it('end: декодирует cashSubmittedDiram (число) в bigint, передаёт shiftId/userId', async () => {
    const { start, end, endExecute } = fakeUseCases()
    const controller = new CourierShiftsController(start, end)

    const response = await controller.end('shift-1', COURIER_CLAIMS, { cashSubmittedDiram: 9_500 })

    expect(endExecute).toHaveBeenCalledWith({ userId: 'user-1', shiftId: 'shift-1', cashSubmittedDiram: 9_500n })
    expect(response.data.status).toBe('closed')
    expect(response.data.discrepancyDiram).toBe(0)
  })
})
