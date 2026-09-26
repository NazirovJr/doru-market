import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  CashAmountMismatchError,
  ForbiddenError,
  ForbiddenTransitionError,
  HandoverOtpNotFoundError,
  NotFoundError,
  OtpAttemptsExceededError,
  OtpExpiredError,
  OtpMismatchError,
} from '@dorutj/contracts'
import type { OtpCodeRecord, OtpCodesRepository, RateLimitCheckerPort, UnitOfWorkPort } from '@/modules/auth/index.js'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '../../domain/delivery-assignment-snapshot.js'
import type { DeliveryAssignmentRepositoryPort } from '../ports/delivery-assignment.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { CourierEarningsRepositoryPort } from '../ports/courier-earnings.repository.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { DeliverUseCase } from './deliver.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const ASSIGNMENT_ID = 'assignment-1'
const ORDER_ID = 'order-1'
const COURIER_ID = 'courier-1'
const USER_ID = 'user-1'
const OTP_ID = 'otp-1'
const OTP_CODE = '1234'
const SHA256_HEX_LENGTH = 64

function hashOtpCode(code: string, salt: string): string {
  return createHash('sha256').update(`${code}:${salt}`).digest('hex').slice(0, SHA256_HEX_LENGTH)
}

function makeAssignment(): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: ASSIGNMENT_ID,
    orderId: ORDER_ID,
    courierId: COURIER_ID,
    status: 'en_route_to_customer',
    landmarkText: null,
    handoverOtpId: OTP_ID,
    cashCollectedDiram: null,
    cashChangeDiram: null,
    reassignReason: null,
    reassignedBy: null,
    assignedAt: NOW,
    pickedUpFromPharmacyAt: NOW,
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

function makeCourier(chainId: string | null = null): Courier {
  return Courier.create({ id: COURIER_ID, userId: USER_ID, chainId, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
}

function makeOrderContext(paymentMethod = 'card_online'): DeliveryOrderContext {
  return {
    orderId: ORDER_ID,
    tenantId: 'tenant-1',
    pharmacyId: 'pharmacy-1',
    customerId: 'customer-1',
    medicineIds: [],
    itemsCount: 1,
    paymentMethod,
    deliveryGeoPoint: null,
    deliveryFeeDiram: 500n,
    totalAmountDiram: 6000n,
    deliveryAddress: 'Addr',
    deliveryLandmark: null,
    handoverOtpId: OTP_ID,
  }
}

function makeOtpRecord(overrides: Partial<OtpCodeRecord> = {}): OtpCodeRecord {
  return {
    id: OTP_ID,
    tenantId: 'tenant-1',
    subjectRef: ORDER_ID,
    purpose: 'delivery_handover',
    codeHash: hashOtpCode(OTP_CODE, OTP_ID),
    plainCode: OTP_CODE,
    attempts: 0,
    issuedAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 60_000),
    consumedAt: null,
    ...overrides,
  }
}

interface Harness {
  readonly useCase: DeliverUseCase
  readonly assignmentsSave: ReturnType<typeof vi.fn>
  readonly outboxAppend: ReturnType<typeof vi.fn>
  readonly earningsCreate: ReturnType<typeof vi.fn>
  readonly markOrderDelivered: ReturnType<typeof vi.fn>
  readonly markConsumed: ReturnType<typeof vi.fn>
  readonly incrementAttempts: ReturnType<typeof vi.fn>
}

function makeUseCase(params: {
  assignment?: DeliveryAssignment | null
  courier?: Courier | null
  orderContext?: DeliveryOrderContext
  otpRecord?: OtpCodeRecord | null
  rateLimitCount?: number
}): Harness {
  const assignmentsSave = vi.fn().mockResolvedValue(undefined)
  const assignments: DeliveryAssignmentRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.assignment === undefined ? makeAssignment() : params.assignment),
    findActiveByOrderId: vi.fn().mockResolvedValue(null),
    findByCourierAndStatuses: vi.fn().mockResolvedValue([]),
    findByOrderId: vi.fn().mockResolvedValue(null),
    hasActiveAssignmentForCourier: vi.fn().mockResolvedValue(false),
    claimUnassigned: vi.fn().mockResolvedValue(true),
    assignManual: vi.fn().mockResolvedValue(true),
    findUnassignedPool: vi.fn().mockResolvedValue([]),
    findByStatuses: vi.fn().mockResolvedValue([]),
    save: assignmentsSave,
  }
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByUserId: vi.fn().mockResolvedValue(params.courier === undefined ? makeCourier() : params.courier),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const markOrderDelivered = vi.fn().mockResolvedValue(undefined)
  const orders: DeliveryOrdersPort = {
    getOrderForRating: vi.fn().mockResolvedValue(null),
    getDeliveryContext: vi.fn().mockResolvedValue(params.orderContext ?? makeOrderContext()),
    markOrderDelivered,
  }
  const outboxAppend = vi.fn().mockResolvedValue(undefined)
  const outbox: DeliveryOutboxPort = { append: outboxAppend }
  const earningsCreate = vi.fn().mockResolvedValue(undefined)
  const earnings: CourierEarningsRepositoryPort = { findPage: vi.fn(), create: earningsCreate }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const markConsumed = vi.fn().mockResolvedValue(undefined)
  const incrementAttempts = vi.fn().mockResolvedValue(undefined)
  const otpRecordValue = params.otpRecord === undefined ? makeOtpRecord() : params.otpRecord
  const otpCodes: OtpCodesRepository = {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(otpRecordValue),
    findByIdForUpdate: vi.fn().mockResolvedValue(otpRecordValue),
    markConsumed,
    incrementAttempts,
    findActiveBySubject: vi.fn(),
    countBySubjectAndPurpose: vi.fn(),
  }
  const rateLimit: RateLimitCheckerPort = {
    incrementAndGet: vi.fn().mockResolvedValue({ count: params.rateLimitCount ?? 1, ttlSeconds: 900 }),
  }
  const authUow: UnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const ids = { next: () => 'earning-1' }
  const clock = { now: () => NOW }
  return {
    useCase: new DeliverUseCase(couriers, assignments, orders, outbox, earnings, uow, otpCodes, rateLimit, authUow, clock, ids),
    assignmentsSave,
    outboxAppend,
    earningsCreate,
    markOrderDelivered,
    markConsumed,
    incrementAttempts,
  }
}

describe('DeliverUseCase', () => {
  it('TC-DELIV-013: верный OTP, TTL не истёк -> 200, delivered, OrderDeliveredEvent, courier_earnings (chainId=null)', async () => {
    const { useCase, assignmentsSave, outboxAppend, earningsCreate, markOrderDelivered, markConsumed } = makeUseCase({})

    const result = await useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, otpCode: OTP_CODE })

    expect(result.deliveryAssignmentId).toBe(ASSIGNMENT_ID)
    const saved = assignmentsSave.mock.calls[0]?.[0] as DeliveryAssignment
    expect(saved.status).toBe('delivered')
    expect(markConsumed).toHaveBeenCalledWith(undefined, OTP_ID, NOW)
    const [event] = outboxAppend.mock.calls[0] as [unknown]
    expect(event).toMatchObject({ type: 'OrderDeliveredEvent', deliveryAssignmentId: ASSIGNMENT_ID, courierId: COURIER_ID })
    expect(earningsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ courierId: COURIER_ID, deliveryAssignmentId: ASSIGNMENT_ID, amountDiram: 500n, idempotencyKey: ASSIGNMENT_ID }) as unknown,
      undefined,
    )
    expect(markOrderDelivered).toHaveBeenCalledWith({ orderId: ORDER_ID, tenantId: 'tenant-1', now: NOW })
  })

  it('chainId !== null (собственный флот сети) -> courier_earnings НЕ создаётся (REQ-COUR-3)', async () => {
    const { useCase, earningsCreate } = makeUseCase({ courier: makeCourier('chain-1') })

    await useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, otpCode: OTP_CODE })

    expect(earningsCreate).not.toHaveBeenCalled()
  })

  it('TC-DELIV-012: cash_courier, recordCash НЕ вызван -> CashAmountMismatchError (домен отклоняет)', async () => {
    const { useCase } = makeUseCase({ orderContext: makeOrderContext('cash_courier') })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, otpCode: OTP_CODE })).rejects.toBeInstanceOf(
      CashAmountMismatchError,
    )
  })

  it('OTP истёк -> 400 OtpExpiredError', async () => {
    const { useCase } = makeUseCase({ otpRecord: makeOtpRecord({ expiresAt: new Date(NOW.getTime() - 1000) }) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, otpCode: OTP_CODE })).rejects.toBeInstanceOf(OtpExpiredError)
  })

  it('неверный код -> 400 OtpMismatchError', async () => {
    const { useCase } = makeUseCase({})

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, otpCode: '0000' })).rejects.toBeInstanceOf(OtpMismatchError)
  })

  it('TC-DELIV-075: дубль deliver ПОСЛЕ успеха (otp уже consumedAt) -> 400 OtpMismatchError, НЕ 500', async () => {
    const { useCase } = makeUseCase({ otpRecord: makeOtpRecord({ consumedAt: NOW }) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, otpCode: OTP_CODE })).rejects.toBeInstanceOf(OtpMismatchError)
  })

  it('превышен презентационный лимит попыток -> 423 OtpAttemptsExceededError', async () => {
    const { useCase } = makeUseCase({ rateLimitCount: 999 })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, otpCode: OTP_CODE })).rejects.toBeInstanceOf(
      OtpAttemptsExceededError,
    )
  })

  it('назначение принадлежит другому курьеру -> ForbiddenError', async () => {
    const otherCourier = Courier.create({ id: 'courier-2', userId: USER_ID, chainId: null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
    const { useCase } = makeUseCase({ courier: otherCourier })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, otpCode: OTP_CODE })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('handoverOtpId не закреплён на назначении -> HandoverOtpNotFoundError', async () => {
    const snapshot = makeAssignment().toSnapshot()
    const { useCase } = makeUseCase({ assignment: DeliveryAssignment.restore({ ...snapshot, handoverOtpId: null }) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, otpCode: OTP_CODE })).rejects.toBeInstanceOf(
      HandoverOtpNotFoundError,
    )
  })

  it('статус не en_route_to_customer -> ForbiddenTransitionError', async () => {
    const snapshot = makeAssignment().toSnapshot()
    const { useCase } = makeUseCase({ assignment: DeliveryAssignment.restore({ ...snapshot, status: 'assigned' }) })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, otpCode: OTP_CODE })).rejects.toBeInstanceOf(
      ForbiddenTransitionError,
    )
  })

  it('назначение не найдено -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ assignment: null })

    await expect(useCase.execute({ assignmentId: ASSIGNMENT_ID, userId: USER_ID, otpCode: OTP_CODE })).rejects.toBeInstanceOf(NotFoundError)
  })
})
