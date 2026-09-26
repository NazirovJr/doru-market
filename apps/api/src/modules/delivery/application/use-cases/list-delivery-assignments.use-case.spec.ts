import { describe, expect, it, vi } from 'vitest'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort, FindByStatusesInput } from '../ports/delivery-assignment.repository.port.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { PharmacyLookupPort, PharmacyLocation } from '../ports/pharmacy-lookup.port.js'
import { ListDeliveryAssignmentsUseCase } from './list-delivery-assignments.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')

function makeAssignment(id: string): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id,
    orderId: `order-${id}`,
    courierId: null,
    status: 'unassigned',
    landmarkText: null,
    handoverOtpId: null,
    cashCollectedDiram: null,
    cashChangeDiram: null,
    reassignReason: null,
    reassignedBy: null,
    assignedAt: null,
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
  }
  return DeliveryAssignment.restore(snapshot)
}

function makeUseCase(params: {
  page: readonly DeliveryAssignment[]
  pharmacyChainByOrder: Record<string, string | null>
}): { useCase: ListDeliveryAssignmentsUseCase; findByStatuses: ReturnType<typeof vi.fn>; findByIds: ReturnType<typeof vi.fn> } {
  const findByStatuses = vi.fn().mockImplementation((_input: FindByStatusesInput) => Promise.resolve(params.page))
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByCourierAndStatuses: vi.fn().mockResolvedValue([]),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    save: vi.fn().mockResolvedValue(undefined),
    claimUnassigned: vi.fn().mockResolvedValue(true),
    assignManual: vi.fn().mockResolvedValue(true),
    findUnassignedPool: vi.fn().mockResolvedValue([]),
    findByStatuses,
  }
  const orders: DeliveryOrdersPort = {
    getOrderForRating: vi.fn().mockResolvedValue(null),
    getDeliveryContext: vi.fn().mockImplementation((orderId: string) => {
      const chainId = params.pharmacyChainByOrder[orderId]
      if (chainId === undefined) return Promise.resolve(null)
      const context: DeliveryOrderContext = {
        orderId,
        tenantId: 't',
        pharmacyId: `pharmacy-${orderId}`,
        customerId: 'customer-1',
        medicineIds: [],
        itemsCount: 1,
        paymentMethod: 'cash_courier',
        deliveryGeoPoint: null,
        deliveryFeeDiram: 0n,
        totalAmountDiram: 0n,
        deliveryAddress: 'Addr',
        deliveryLandmark: null,
        handoverOtpId: null,
      }
      return Promise.resolve(context)
    }),
    markOrderDelivered: vi.fn(),
  }
  const findByIds = vi.fn().mockImplementation((pharmacyIds: readonly string[]) => {
    const locations: PharmacyLocation[] = pharmacyIds.map((pharmacyId) => {
      const orderId = pharmacyId.replace('pharmacy-', '')
      const chainId = params.pharmacyChainByOrder[orderId] ?? null
      return { id: pharmacyId, name: 'P', addressText: 'A', geoPoint: { latitude: 0, longitude: 0 } as never, chainId }
    })
    return Promise.resolve(locations)
  })
  const pharmacies: PharmacyLookupPort = { findById: vi.fn(), findByIds }
  return { useCase: new ListDeliveryAssignmentsUseCase(assignments, orders, pharmacies), findByStatuses, findByIds }
}

describe('ListDeliveryAssignmentsUseCase', () => {
  it('super_admin видит все назначения без chain-фильтрации, включая пул', async () => {
    const page = [makeAssignment('a1'), makeAssignment('a2')]
    const { useCase } = makeUseCase({ page, pharmacyChainByOrder: { 'order-a1': 'chain-A', 'order-a2': 'chain-B' } })

    const result = await useCase.execute({ statuses: ['unassigned'], limit: 20, cursor: null, actor: { role: 'super_admin', chainId: null } })

    expect(result.items.map((i) => i.id)).toEqual(['a1', 'a2'])
  })

  it('SRS-DELIV-072: pharmacy_admin видит только назначения своей сети (implicit chainId-скоуп), один пакетный запрос pharmacies', async () => {
    const page = [makeAssignment('own'), makeAssignment('other')]
    const { useCase, findByIds } = makeUseCase({ page, pharmacyChainByOrder: { 'order-own': 'chain-A', 'order-other': 'chain-B' } })

    const result = await useCase.execute({ statuses: ['unassigned'], limit: 20, cursor: null, actor: { role: 'pharmacy_admin', chainId: 'chain-A' } })

    expect(result.items.map((i) => i.id)).toEqual(['own'])
    expect(findByIds).toHaveBeenCalledTimes(1)
    expect(findByIds).toHaveBeenCalledWith(['pharmacy-order-own', 'pharmacy-order-other'])
  })

  it('hasMore=true, когда репозиторий вернул limit+1 строк (внутренний over-fetch)', async () => {
    const page = [makeAssignment('a1'), makeAssignment('a2')] // limit=1 -> запрошено 2, значит есть ещё
    const { useCase, findByStatuses } = makeUseCase({ page, pharmacyChainByOrder: { 'order-a1': null, 'order-a2': null } })

    const result = await useCase.execute({ statuses: ['unassigned'], limit: 1, cursor: null, actor: { role: 'super_admin', chainId: null } })

    expect(result.hasMore).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.nextCursor).toEqual({ createdAt: NOW, id: 'a1' })
    expect((findByStatuses.mock.calls[0]?.[0] as FindByStatusesInput).limit).toBe(2)
  })
})
