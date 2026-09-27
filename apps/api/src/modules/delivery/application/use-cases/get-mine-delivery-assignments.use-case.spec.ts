import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { GetMineDeliveryAssignmentsUseCase } from './get-mine-delivery-assignments.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const COURIER_ID = 'courier-1'
const USER_ID = 'user-1'

function makeAssignment(id: string): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id,
    orderId: `order-${id}`,
    courierId: COURIER_ID,
    status: 'assigned',
    landmarkText: null,
    handoverOtpId: null,
    cashCollectedDiram: null,
    cashChangeDiram: null,
    reassignReason: null,
    reassignedBy: null,
    assignedAt: NOW,
    pickedUpFromPharmacyAt: null,
    deliveredAt: null,
    failedReason: null,
    createdAt: NOW,
    requiresColdChain: false,
    coldChainBagConfirmed: null,
    coldChainBagConfirmedAt: null,
    contactAttemptsCount: 0,
    lastContactAttemptAt: null,
    distanceMeters: null,
    proofPhotoUrl: null,
  }
  return DeliveryAssignment.restore(snapshot)
}

function makeUseCase(params: {
  courier?: Courier | null
  findByCourierAndStatuses?: ReturnType<typeof vi.fn>
}): { useCase: GetMineDeliveryAssignmentsUseCase; findByCourierAndStatuses: ReturnType<typeof vi.fn> } {
  const findByCourierAndStatuses = params.findByCourierAndStatuses ?? vi.fn().mockResolvedValue([])
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn(),
    findActiveByOrderId: vi.fn(),
    findByCourierAndStatuses: findByCourierAndStatuses as DeliveryAssignmentRepositoryPort['findByCourierAndStatuses'],
    findByOrderId: vi.fn(),
    hasActiveAssignmentForCourier: vi.fn(),
    claimUnassigned: vi.fn(),
    assignManual: vi.fn(),
    findUnassignedPool: vi.fn(),
    findByStatuses: vi.fn(),
    save: vi.fn(),
  }
  const courier =
    params.courier === undefined
      ? Courier.create({ id: COURIER_ID, userId: USER_ID, chainId: null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
      : params.courier
  const couriers: CourierRepositoryPort = { findById: vi.fn(), findByUserId: vi.fn().mockResolvedValue(courier), save: vi.fn() }
  return { useCase: new GetMineDeliveryAssignmentsUseCase(couriers, assignments), findByCourierAndStatuses }
}

describe('GetMineDeliveryAssignmentsUseCase', () => {
  it('scope=active -> запрашивает НЕтерминальные статусы для courierId', async () => {
    const { useCase, findByCourierAndStatuses } = makeUseCase({})

    await useCase.execute({ userId: USER_ID, scope: 'active', limit: 20, cursor: null })

    const [input] = findByCourierAndStatuses.mock.calls[0] as [{ courierId: string; statuses: readonly string[] }]
    expect(input.courierId).toBe(COURIER_ID)
    expect(input.statuses).not.toContain('delivered')
    expect(input.statuses).toContain('assigned')
  })

  it('scope=history -> запрашивает ТОЛЬКО терминальные статусы', async () => {
    const { useCase, findByCourierAndStatuses } = makeUseCase({})

    await useCase.execute({ userId: USER_ID, scope: 'history', limit: 20, cursor: null })

    const [input] = findByCourierAndStatuses.mock.calls[0] as [{ statuses: readonly string[] }]
    expect(input.statuses).toEqual(['delivered', 'delivery_failed'])
  })

  it('hasMore=true, когда строк больше limit', async () => {
    const rows = [makeAssignment('a1'), makeAssignment('a2'), makeAssignment('a3')]
    const { useCase } = makeUseCase({ findByCourierAndStatuses: vi.fn().mockResolvedValue(rows) })

    const result = await useCase.execute({ userId: USER_ID, scope: 'active', limit: 2, cursor: null })

    expect(result.items).toHaveLength(2)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).not.toBeNull()
  })

  it('актор не найден как курьер -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ courier: null })

    await expect(useCase.execute({ userId: USER_ID, scope: 'active', limit: 20, cursor: null })).rejects.toBeInstanceOf(NotFoundError)
  })
})
