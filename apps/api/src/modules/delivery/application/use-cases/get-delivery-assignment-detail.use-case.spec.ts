import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError, type DeliveryAssignmentStatus } from '@dorutj/contracts'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { PharmacyLookupPort, PharmacyLocation } from '../ports/pharmacy-lookup.port.js'
import type { MaskedCallingPort } from '../ports/masked-calling.port.js'
import { GetDeliveryAssignmentDetailUseCase } from './get-delivery-assignment-detail.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const COURIER_ID = 'courier-1'
const COURIER_USER_ID = 'user-courier'
const CUSTOMER_ID = 'customer-1'

function makeAssignment(status: DeliveryAssignmentStatus = 'assigned'): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    courierId: COURIER_ID,
    status,
    landmarkText: null,
    handoverOtpId: 'otp-1',
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
    contactAttemptsCount: 2,
    lastContactAttemptAt: null,
    distanceMeters: null,
    proofPhotoUrl: null,
  }
  return DeliveryAssignment.restore(snapshot)
}

function makeOrderContext(): DeliveryOrderContext {
  return {
    orderId: ORDER_ID,
    tenantId: 'tenant-1',
    pharmacyId: 'pharmacy-1',
    customerId: CUSTOMER_ID,
    medicineIds: [],
    itemsCount: 1,
    paymentMethod: 'cash_courier',
    deliveryGeoPoint: null,
    deliveryFeeDiram: 500n,
    totalAmountDiram: 6000n,
    deliveryAddress: 'Addr',
    deliveryLandmark: 'Landmark',
    handoverOtpId: 'otp-1',
  }
}

function makeUseCase(params: { assignment?: DeliveryAssignment | null; pharmacyChainId?: string | null }): GetDeliveryAssignmentDetailUseCase {
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.assignment === undefined ? makeAssignment() : params.assignment),
    findActiveByOrderId: vi.fn(),
    findByCourierAndStatuses: vi.fn(),
    findByOrderId: vi.fn(),
    hasActiveAssignmentForCourier: vi.fn(),
    claimUnassigned: vi.fn(),
    assignManual: vi.fn(),
    findUnassignedPool: vi.fn(),
    findByStatuses: vi.fn(),
    save: vi.fn(),
  }
  const courier = Courier.create({ id: COURIER_ID, userId: COURIER_USER_ID, chainId: null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
  const couriers: CourierRepositoryPort = {
    findById: vi.fn(),
    findByUserId: vi.fn().mockImplementation((userId: string) => Promise.resolve(userId === COURIER_USER_ID ? courier : null)),
    save: vi.fn(),
  }
  const orders: DeliveryOrdersPort = {
    getOrderForRating: vi.fn(),
    getDeliveryContext: vi.fn().mockResolvedValue(makeOrderContext()),
    markOrderDelivered: vi.fn(),
    verifyHandoverOtp: vi.fn(),
    reissueHandoverOtp: vi.fn(),
  }
  const geo = GeoPoint.create(38.5598, 68.787)
  if (!geo.ok) throw new Error('fixture error')
  const pharmacyLocation: PharmacyLocation = {
    id: 'pharmacy-1',
    name: 'Pharmacy',
    addressText: 'PharmAddr',
    geoPoint: geo.value,
    chainId: params.pharmacyChainId ?? null,
  }
  const pharmacies: PharmacyLookupPort = { findById: vi.fn().mockResolvedValue(pharmacyLocation), findByIds: vi.fn() }
  const maskedCalling: MaskedCallingPort = { getCustomerContact: vi.fn().mockResolvedValue({ phoneNumber: '+992900000000', isMasked: false }) }
  return new GetDeliveryAssignmentDetailUseCase(couriers, assignments, orders, pharmacies, maskedCalling)
}

const SUPER_ADMIN_ACTOR = { userId: 'super-admin-1', role: 'super_admin' as const, tenantId: null, pharmacyId: null, chainId: null }

describe('GetDeliveryAssignmentDetailUseCase', () => {
  it('курьер-владелец видит детали, включая customerContact', async () => {
    const useCase = makeUseCase({})

    const view = await useCase.execute({
      assignmentId: ASSIGNMENT_ID,
      actor: { userId: COURIER_USER_ID, role: 'courier', tenantId: null, pharmacyId: null, chainId: null },
    })

    expect(view.pharmacy.addressText).toBe('PharmAddr')
    expect(view.customerAddress.addressText).toBe('Addr')
    expect(view.customerAddress.landmarkText).toBe('Landmark')
    expect(view.otpIssued).toBe(true)
    expect(view.contactAttemptsCount).toBe(2)
    expect(view.customerContact).toEqual({ phoneNumber: '+992900000000', isMasked: false })
  })

  it('customer-владелец заказа видит детали, БЕЗ customerContact (своего же номера)', async () => {
    const useCase = makeUseCase({})

    const view = await useCase.execute({
      assignmentId: ASSIGNMENT_ID,
      actor: { userId: CUSTOMER_ID, role: 'customer', tenantId: null, pharmacyId: null, chainId: null },
    })

    expect(view.customerContact).toBeNull()
  })

  it('pharmacist той же аптеки и тенанта -> видит детали', async () => {
    const useCase = makeUseCase({})

    const view = await useCase.execute({
      assignmentId: ASSIGNMENT_ID,
      actor: { userId: 'pharmacist-1', role: 'pharmacist', tenantId: 'tenant-1', pharmacyId: 'pharmacy-1', chainId: null },
    })

    expect(view.id).toBe(ASSIGNMENT_ID)
  })

  it('pharmacist чужой аптеки того же тенанта -> ForbiddenError', async () => {
    const useCase = makeUseCase({})

    await expect(
      useCase.execute({
        assignmentId: ASSIGNMENT_ID,
        actor: { userId: 'pharmacist-2', role: 'pharmacist', tenantId: 'tenant-1', pharmacyId: 'other-pharmacy', chainId: null },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pharmacy_admin чужой сети (chainId не совпадает) -> ForbiddenError', async () => {
    const useCase = makeUseCase({ pharmacyChainId: 'chain-a' })

    await expect(
      useCase.execute({
        assignmentId: ASSIGNMENT_ID,
        actor: { userId: 'admin-1', role: 'pharmacy_admin', tenantId: 'tenant-1', pharmacyId: null, chainId: 'other-chain' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pharmacy_admin своей сети -> видит детали', async () => {
    const useCase = makeUseCase({ pharmacyChainId: 'chain-a' })

    const view = await useCase.execute({
      assignmentId: ASSIGNMENT_ID,
      actor: { userId: 'admin-1', role: 'pharmacy_admin', tenantId: 'tenant-1', pharmacyId: null, chainId: 'chain-a' },
    })

    expect(view.id).toBe(ASSIGNMENT_ID)
  })

  it('support_agent чужого тенанта -> NotFoundError (тенант скрыт, SRS-API-046)', async () => {
    const useCase = makeUseCase({})

    await expect(
      useCase.execute({
        assignmentId: ASSIGNMENT_ID,
        actor: { userId: 'support-1', role: 'support_agent', tenantId: 'other-tenant', pharmacyId: null, chainId: null },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('support_agent своего тенанта -> видит детали без доп. скоупа по аптеке', async () => {
    const useCase = makeUseCase({})

    const view = await useCase.execute({
      assignmentId: ASSIGNMENT_ID,
      actor: { userId: 'support-1', role: 'support_agent', tenantId: 'tenant-1', pharmacyId: null, chainId: null },
    })

    expect(view.id).toBe(ASSIGNMENT_ID)
  })

  it('чужой курьер -> ForbiddenError', async () => {
    const useCase = makeUseCase({})

    await expect(
      useCase.execute({ assignmentId: ASSIGNMENT_ID, actor: { userId: 'other-user', role: 'courier', tenantId: null, pharmacyId: null, chainId: null } }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('чужой customer -> ForbiddenError', async () => {
    const useCase = makeUseCase({})

    await expect(
      useCase.execute({
        assignmentId: ASSIGNMENT_ID,
        actor: { userId: 'other-customer', role: 'customer', tenantId: null, pharmacyId: null, chainId: null },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('status=unassigned -> 403 FORBIDDEN (тикет п.2)', async () => {
    const useCase = makeUseCase({ assignment: makeAssignment('unassigned') })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, actor: SUPER_ADMIN_ACTOR })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('назначение не найдено -> NotFoundError', async () => {
    const useCase = makeUseCase({ assignment: null })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, actor: SUPER_ADMIN_ACTOR })).rejects.toBeInstanceOf(NotFoundError)
  })
})
