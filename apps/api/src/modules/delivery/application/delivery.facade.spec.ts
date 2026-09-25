import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/index.js'
import { Courier } from '../domain/courier.entity.js'
import { DeliveryAssignment } from '../domain/delivery-assignment.entity.js'
import type { CourierRepositoryPort } from './ports/courier.repository.port.js'
import type { DeliveryAssignmentRepositoryPort } from './ports/delivery-assignment.repository.port.js'
import type { CalculateDeliveryFeeUseCase } from './use-cases/calculate-delivery-fee.use-case.js'
import { DeliveryFacade } from './delivery.facade.js'

const NOW = new Date('2026-09-05T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const COURIER_ID = 'courier-1'

function makeClock(): Clock {
  return { now: () => NOW }
}

function makeAssignment(): DeliveryAssignment {
  const result = DeliveryAssignment.create({
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    landmarkText: null,
    requiresColdChain: false,
    hasActiveNonTerminalAssignment: false,
    now: NOW,
  })
  if (!result.ok) throw result.error
  return result.value
}

function makeCourier(overrides: { chainId?: string | null } = {}): Courier {
  return Courier.create({
    id: COURIER_ID,
    userId: 'user-1',
    chainId: overrides.chainId ?? null,
    taxStatus: 'individual_patent',
    vehicleType: 'car',
    now: NOW,
  })
}

function makeFacade(params: { assignment?: DeliveryAssignment | null; courier?: Courier | null } = {}): {
  facade: DeliveryFacade
  assignmentsSave: ReturnType<typeof vi.fn>
  couriersSave: ReturnType<typeof vi.fn>
  calculateFeeExecute: ReturnType<typeof vi.fn>
} {
  const assignment = params.assignment === undefined ? makeAssignment() : params.assignment
  const courier = params.courier === undefined ? makeCourier() : params.courier
  const assignmentsSave = vi.fn().mockResolvedValue(undefined)
  const couriersSave = vi.fn().mockResolvedValue(undefined)
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(assignment),
    findActiveByOrderId: vi.fn().mockResolvedValue(assignment),
    findByOrderId: vi.fn().mockResolvedValue(assignment),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    save: assignmentsSave,
  }
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(courier),
    findByUserId: vi.fn().mockResolvedValue(courier),
    save: couriersSave,
  }
  const calculateFeeExecute = vi.fn().mockResolvedValue(1234n)
  const calculateFee = { execute: calculateFeeExecute } as unknown as CalculateDeliveryFeeUseCase
  const facade = new DeliveryFacade(assignments, couriers, makeClock(), calculateFee)
  return { facade, assignmentsSave, couriersSave, calculateFeeExecute }
}

describe('DeliveryFacade', () => {
  it('createAssignment: делегирует DeliveryAssignment.create() и сохраняет через репозиторий', async () => {
    const { facade, assignmentsSave } = makeFacade({ assignment: null })
    const result = await facade.createAssignment({
      id: ASSIGNMENT_ID,
      orderId: ORDER_ID,
      landmarkText: 'gate 3',
      requiresColdChain: false,
    })
    expect(result.id).toBe(ASSIGNMENT_ID)
    expect(result.status).toBe('unassigned')
    expect(assignmentsSave).toHaveBeenCalledOnce()
  })

  it('assign: резолвит курьера через CourierRepositoryPort и вызывает DeliveryAssignment.assign()', async () => {
    const { facade, assignmentsSave } = makeFacade()
    await facade.assign(ASSIGNMENT_ID, COURIER_ID, null)
    expect(assignmentsSave).toHaveBeenCalledOnce()
    const saved = assignmentsSave.mock.calls[0]?.[0] as DeliveryAssignment
    expect(saved.status).toBe('assigned')
    expect(saved.courierId).toBe(COURIER_ID)
  })

  it('assign: назначение не найдено -> NotFoundError', async () => {
    const { facade } = makeFacade({ assignment: null })
    await expect(facade.assign(ASSIGNMENT_ID, COURIER_ID, null)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('assign: курьер не найден -> NotFoundError', async () => {
    const { facade } = makeFacade({ courier: null })
    await expect(facade.assign(ASSIGNMENT_ID, COURIER_ID, null)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('reassign: требует непустой reason (проверка домена пробрасывается)', async () => {
    const { facade } = makeFacade()
    await expect(
      facade.reassign({ assignmentId: ASSIGNMENT_ID, newCourierId: 'courier-2', reason: '', reassignedBy: 'dispatcher-1' }),
    ).rejects.toThrow()
  })

  it('hasActiveAssignment: true, когда репозиторий возвращает нетерминальное назначение', async () => {
    const { facade } = makeFacade()
    expect(await facade.hasActiveAssignment(ORDER_ID)).toBe(true)
  })

  it('hasActiveAssignment: false, когда активного назначения нет', async () => {
    const { facade } = makeFacade({ assignment: null })
    expect(await facade.hasActiveAssignment(ORDER_ID)).toBe(false)
  })

  it('getActiveAssignment: возвращает snapshot, не сам domain-объект', async () => {
    const { facade } = makeFacade()
    const snapshot = await facade.getActiveAssignment(ORDER_ID)
    expect(snapshot?.id).toBe(ASSIGNMENT_ID)
  })

  it('getActiveAssignment: null, когда активного назначения нет', async () => {
    const { facade } = makeFacade({ assignment: null })
    expect(await facade.getActiveAssignment(ORDER_ID)).toBeNull()
  })

  it('calculateDeliveryFee: делегирует CalculateDeliveryFeeUseCase.execute() (DTJ-322)', async () => {
    const { facade, calculateFeeExecute } = makeFacade()
    const geoResult = await import('@/shared-kernel/index.js').then((m) => m.GeoPoint.create(38.5, 68.7))
    if (!geoResult.ok) throw geoResult.error
    const input = { pharmacyGeoPoint: geoResult.value, customerGeoPoint: geoResult.value, tenantId: 'tenant-1', itemsTotalDiram: 10000n }
    const fee = await facade.calculateDeliveryFee(input)
    expect(fee).toBe(1234n)
    expect(calculateFeeExecute).toHaveBeenCalledWith(input)
  })

  it('assignReturnCourier: заглушка возвращает null (DTJ-273/274 вне периметра)', async () => {
    const { facade } = makeFacade()
    expect(await facade.assignReturnCourier('tenant-1', 'return-1')).toBeNull()
  })
})
